//! Aula class contract on Freenet: one contract per class.
//!
//! Parameters = teacher_pubkey (32 bytes Ed25519) || salt (16 bytes). The class address (= hex parameters) is the join code.
//! Every record is signed on its own by its author (`by`), so a state is self-verifying and any subset travels as a delta:
//!   signature over `aula1|<params hex>|<key>|<by>|<updated_at>|<deleted>|<data>`
//! Who may write which key:
//!   meta:class, post:<id>              teacher only
//!   member:<pk>                        <pk> itself (join / leave) or the teacher (add / remove); a teacher tombstone is final
//!   sub:<post>:<pk>, cmt:<post>:<id>   an active member (sub: only for its own <pk>); a comment is replaced only by its author or the teacher
//! Merge is last-write-wins per record, ordered by (updated_at, signature). Anything else is rejected.
//! Limits: `updated_at` is client time (no clock in a contract) and records are readable by anyone who knows the address.

use freenet_stdlib::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

type R<T> = Result<T, String>;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Record {
    #[serde(default)]
    pub data: String,
    pub updated_at: u64,
    #[serde(default)]
    pub deleted: bool,
    pub by: String,
    pub sig: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct ClassState {
    #[serde(default)]
    pub records: BTreeMap<String, Record>,
    #[serde(default)]
    pub updated_at: u64,
}

type Summary = BTreeMap<String, (u64, String)>;

const MAX_KEY_LEN: usize = 160;
const MAX_DATA_BYTES: usize = 64 * 1024;
const MAX_RECORDS: usize = 20_000;

fn version(r: &Record) -> (u64, String) {
    (r.updated_at, r.sig.chars().take(16).collect())
}

fn is_valid_key(k: &str) -> bool {
    !k.is_empty() && k.len() <= MAX_KEY_LEN && k.contains(':') && !k.chars().any(|c| c == '|' || c.is_control() || c.is_whitespace())
}

pub fn record_msg(params: &str, key: &str, r: &Record) -> String {
    format!("aula1|{params}|{key}|{}|{}|{}|{}", r.by, r.updated_at, r.deleted, r.data)
}

fn is_pk(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn verify_sig(params: &str, key: &str, r: &Record) -> R<()> {
    let pk: [u8; 32] = hex::decode(&r.by).map_err(|e| e.to_string())?.try_into().map_err(|_| "bad key")?;
    let vk = ed25519_dalek::VerifyingKey::from_bytes(&pk).map_err(|e| format!("invalid key: {e}"))?;
    let sg: [u8; 64] = hex::decode(&r.sig).map_err(|e| e.to_string())?.try_into().map_err(|_| "bad signature length")?;
    vk.verify_strict(record_msg(params, key, r).as_bytes(), &ed25519_dalek::Signature::from_bytes(&sg))
        .map_err(|e| format!("signature failed: {e}"))
}

fn teacher_of(params: &str) -> R<&str> {
    if params.len() != 96 || !is_pk(&params[..64]) {
        return Err("parameters must be 48 bytes: teacher key + salt".into());
    }
    Ok(&params[..64])
}

fn active_member(state: &ClassState, pk: &str) -> bool {
    state.records.get(&format!("member:{pk}")).is_some_and(|m| !m.deleted)
}

/// Rules that need only the record itself (also what `validate_state` enforces).
fn check_record(params: &str, key: &str, r: &Record) -> R<()> {
    let teacher = teacher_of(params)?;
    if !is_valid_key(key) || !is_pk(&r.by) || r.data.len() > MAX_DATA_BYTES {
        return Err(format!("invalid record: {key}"));
    }
    verify_sig(params, key, r)?;
    let parts: Vec<&str> = key.split(':').collect();
    let ok = match parts.as_slice() {
        ["meta", "class"] | ["post", _] => r.by == teacher,
        ["member", pk] => is_pk(pk) && (r.by == *pk || r.by == teacher),
        ["sub", _, pk] => is_pk(pk) && r.by == *pk,
        ["cmt", _, _] => true, // membership is checked on merge
        _ => false,
    };
    if ok { Ok(()) } else { Err(format!("not allowed: {key}")) }
}

pub fn check_state(params: &str, s: &ClassState) -> R<()> {
    if s.records.len() > MAX_RECORDS {
        return Err("too many records".into());
    }
    s.records.iter().try_for_each(|(k, r)| check_record(params, k, r))
}

fn newer(a: &Record, b: &Record) -> bool {
    (a.updated_at, &a.sig) > (b.updated_at, &b.sig)
}

/// Rules that need the state: membership, authorship of overwritten comments, final teacher bans.
/// `Ok(false)` = silently ignored (a banned student's rejoin); `Err` = the whole update is invalid.
fn admit(params: &str, state: &ClassState, key: &str, r: &Record) -> R<bool> {
    let teacher = teacher_of(params)?;
    let cur = state.records.get(key);
    if let Some(c) = cur {
        if key.starts_with("member:") && c.by == teacher && c.deleted && r.by != teacher {
            return Ok(false);
        }
        if key.starts_with("cmt:") && r.by != c.by && r.by != teacher {
            return Err(format!("not the author: {key}"));
        }
    }
    if (key.starts_with("sub:") || key.starts_with("cmt:")) && r.by != teacher && !active_member(state, &r.by) {
        return Err(format!("not a member: {key}"));
    }
    Ok(true)
}

/// Merge verified incoming records (last write wins per record). Membership records go first so a join and
/// its first submission can travel in one delta.
pub fn merge(params: &str, mut state: ClassState, incoming: ClassState) -> R<ClassState> {
    check_state(params, &incoming)?;
    let mut items: Vec<_> = incoming.records.into_iter().collect();
    items.sort_by_key(|(k, _)| !(k.starts_with("member:") || k.starts_with("meta:")));
    for (k, r) in items {
        if !admit(params, &state, &k, &r)? {
            continue;
        }
        if state.records.get(&k).map_or(true, |cur| newer(&r, cur)) {
            state.records.insert(k, r);
        }
    }
    state.updated_at = state.records.values().map(|r| r.updated_at).max().unwrap_or(0);
    Ok(state)
}

pub fn summary_of(state: &ClassState) -> Summary {
    state.records.iter().map(|(k, r)| (k.clone(), version(r))).collect()
}

/// Records the peer lacks or holds an older version of.
pub fn delta_for(state: &ClassState, peer: &Summary) -> Vec<u8> {
    let records: BTreeMap<_, _> = state
        .records
        .iter()
        .filter(|(k, r)| peer.get(*k).map_or(true, |v| version(r) > *v))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    if records.is_empty() {
        return Vec::new();
    }
    serde_json::to_vec(&ClassState { records, updated_at: state.updated_at }).unwrap_or_default()
}

fn params_hex(p: &Parameters) -> String {
    hex::encode(p.as_ref())
}

fn parse_state(b: &[u8]) -> Result<ClassState, ContractError> {
    if b.is_empty() {
        return Ok(ClassState::default());
    }
    serde_json::from_slice(b).map_err(|e| ContractError::Deser(e.to_string()))
}

struct Contract;

#[contract]
impl ContractInterface for Contract {
    fn validate_state(
        parameters: Parameters<'static>,
        state: State<'static>,
        _related: RelatedContracts<'static>,
    ) -> Result<ValidateResult, ContractError> {
        let ok = serde_json::from_slice::<ClassState>(state.as_ref()).is_ok_and(|s| check_state(&params_hex(&parameters), &s).is_ok());
        Ok(if ok { ValidateResult::Valid } else { ValidateResult::Invalid })
    }

    fn update_state(
        parameters: Parameters<'static>,
        state: State<'static>,
        data: Vec<UpdateData<'static>>,
    ) -> Result<UpdateModification<'static>, ContractError> {
        let params = params_hex(&parameters);
        let mut cur = parse_state(state.as_ref())?;
        for u in data {
            let payloads: Vec<Vec<u8>> = match u {
                UpdateData::State(s) => vec![s.as_ref().to_vec()],
                UpdateData::Delta(d) => vec![d.as_ref().to_vec()],
                UpdateData::StateAndDelta { state, delta } => vec![state.as_ref().to_vec(), delta.as_ref().to_vec()],
                _ => return Err(ContractError::InvalidUpdate),
            };
            for p in payloads.into_iter().filter(|p| !p.is_empty()) {
                cur = merge(&params, cur, parse_state(&p)?).map_err(|_| ContractError::InvalidUpdate)?;
            }
        }
        let bytes = serde_json::to_vec(&cur).map_err(|e| ContractError::Deser(e.to_string()))?;
        Ok(UpdateModification::valid(State::from(bytes)))
    }

    fn summarize_state(
        _parameters: Parameters<'static>,
        state: State<'static>,
    ) -> Result<StateSummary<'static>, ContractError> {
        let sum = parse_state(state.as_ref()).map(|s| summary_of(&s)).unwrap_or_default();
        Ok(StateSummary::from(serde_json::to_vec(&sum).map_err(|e| ContractError::Deser(e.to_string()))?))
    }

    fn get_state_delta(
        _parameters: Parameters<'static>,
        state: State<'static>,
        summary: StateSummary<'static>,
    ) -> Result<StateDelta<'static>, ContractError> {
        let peer: Summary = serde_json::from_slice(summary.as_ref()).unwrap_or_default(); // unreadable summary: send everything
        Ok(StateDelta::from(delta_for(&parse_state(state.as_ref())?, &peer)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn sk(n: u8) -> SigningKey {
        SigningKey::from_bytes(&[n; 32])
    }
    fn pk(k: &SigningKey) -> String {
        hex::encode(k.verifying_key().to_bytes())
    }
    fn params(teacher: &SigningKey) -> String {
        format!("{}11223344556677889900aabbccddeeff", pk(teacher))
    }
    fn rec(k: &SigningKey, params: &str, key: &str, data: &str, ts: u64, deleted: bool) -> (String, Record) {
        let mut r = Record { data: data.into(), updated_at: ts, deleted, by: pk(k), sig: String::new() };
        r.sig = hex::encode(k.sign(record_msg(params, key, &r).as_bytes()).to_bytes());
        (key.to_string(), r)
    }
    fn st(items: Vec<(String, Record)>) -> ClassState {
        let updated_at = items.iter().map(|(_, r)| r.updated_at).max().unwrap_or(0);
        ClassState { records: items.into_iter().collect(), updated_at }
    }
    fn put(p: &str, s: ClassState, items: Vec<(String, Record)>) -> R<ClassState> {
        merge(p, s, st(items))
    }

    #[test]
    fn teacher_publishes_and_student_joins_with_first_submission() {
        let (t, s) = (sk(1), sk(2));
        let p = params(&t);
        let c = put(&p, ClassState::default(), vec![rec(&t, &p, "meta:class", "{}", 1, false), rec(&t, &p, "post:a1", "hw", 2, false)]).unwrap();
        let sub_key = format!("sub:a1:{}", pk(&s));
        let c = put(&p, c, vec![rec(&s, &p, &format!("member:{}", pk(&s)), "{}", 3, false), rec(&s, &p, &sub_key, "done", 4, false)]).unwrap();
        assert_eq!(c.records[&sub_key].data, "done");
        assert!(check_state(&p, &c).is_ok());
    }

    #[test]
    fn only_teacher_writes_posts_and_meta() {
        let (t, s) = (sk(1), sk(2));
        let p = params(&t);
        assert!(put(&p, ClassState::default(), vec![rec(&s, &p, "post:a1", "x", 1, false)]).is_err());
        assert!(put(&p, ClassState::default(), vec![rec(&s, &p, "meta:class", "x", 1, false)]).is_err());
        assert!(put(&p, ClassState::default(), vec![rec(&s, &p, "grade:a1:x", "x", 1, false)]).is_err(), "unknown kinds are rejected");
    }

    #[test]
    fn non_member_cannot_submit_or_comment_and_nobody_submits_for_another() {
        let (t, s, o) = (sk(1), sk(2), sk(3));
        let p = params(&t);
        let c = put(&p, ClassState::default(), vec![rec(&s, &p, &format!("member:{}", pk(&s)), "{}", 1, false)]).unwrap();
        assert!(put(&p, c.clone(), vec![rec(&o, &p, &format!("sub:a1:{}", pk(&o)), "x", 2, false)]).is_err());
        assert!(put(&p, c.clone(), vec![rec(&o, &p, "cmt:a1:c1", "x", 2, false)]).is_err());
        assert!(put(&p, c, vec![rec(&s, &p, &format!("sub:a1:{}", pk(&o)), "x", 2, false)]).is_err());
    }

    #[test]
    fn comment_is_replaced_only_by_author_or_teacher() {
        let (t, s, o) = (sk(1), sk(2), sk(3));
        let p = params(&t);
        let mut c = ClassState::default();
        for m in [&s, &o] {
            c = put(&p, c, vec![rec(m, &p, &format!("member:{}", pk(m)), "{}", 1, false)]).unwrap();
        }
        c = put(&p, c, vec![rec(&s, &p, "cmt:a1:c1", "hi", 2, false)]).unwrap();
        assert!(put(&p, c.clone(), vec![rec(&o, &p, "cmt:a1:c1", "forged", 3, false)]).is_err());
        assert!(put(&p, c.clone(), vec![rec(&s, &p, "cmt:a1:c1", "edit", 3, false)]).is_ok());
        assert!(put(&p, c, vec![rec(&t, &p, "cmt:a1:c1", "", 3, true)]).is_ok());
    }

    #[test]
    fn teacher_removal_is_final() {
        let (t, s) = (sk(1), sk(2));
        let p = params(&t);
        let mk = format!("member:{}", pk(&s));
        let mut c = put(&p, ClassState::default(), vec![rec(&s, &p, &mk, "{}", 1, false)]).unwrap();
        c = put(&p, c, vec![rec(&t, &p, &mk, "", 2, true)]).unwrap();
        c = put(&p, c, vec![rec(&s, &p, &mk, "{}", 9, false)]).unwrap(); // rejoin attempt: ignored
        assert!(c.records[&mk].deleted);
        assert!(put(&p, c, vec![rec(&s, &p, &format!("sub:a1:{}", pk(&s)), "x", 10, false)]).is_err());
    }

    #[test]
    fn tampering_and_replayed_signatures_rejected() {
        let (t, s) = (sk(1), sk(2));
        let p = params(&t);
        let (k, mut r) = rec(&t, &p, "post:a1", "hw", 1, false);
        r.data = "tampered".into();
        assert!(put(&p, ClassState::default(), vec![(k, r)]).is_err());
        let (_, r) = rec(&t, &p, "post:a1", "hw", 1, false);
        assert!(put(&p, ClassState::default(), vec![("post:a2".into(), r)]).is_err(), "signature is bound to the key");
        let (_, r) = rec(&s, &p, &format!("member:{}", pk(&s)), "{}", 1, false);
        let other = params(&s);
        assert!(merge(&other, ClassState::default(), st(vec![(format!("member:{}", pk(&s)), r)])).is_err(), "signature is bound to the class");
    }

    #[test]
    fn last_write_wins_and_delta_roundtrip() {
        let t = sk(1);
        let p = params(&t);
        let a = put(&p, ClassState::default(), vec![rec(&t, &p, "post:a1", "v1", 1000, false)]).unwrap();
        let a = put(&p, a, vec![rec(&t, &p, "post:a1", "old", 800, false)]).unwrap();
        assert_eq!(a.records["post:a1"].data, "v1");
        let b = put(&p, ClassState::default(), vec![rec(&t, &p, "post:b", "x", 1, false)]).unwrap();
        let d: ClassState = serde_json::from_slice(&delta_for(&a, &summary_of(&b))).unwrap();
        assert_eq!(merge(&p, b.clone(), d).unwrap().records.len(), 2);
        assert!(delta_for(&a, &summary_of(&a)).is_empty());
    }

    #[test]
    fn bad_parameters_and_keys_rejected() {
        let t = sk(1);
        assert!(merge("00", ClassState::default(), st(vec![rec(&t, &params(&t), "post:a", "x", 1, false)])).is_err());
        let p = params(&t);
        assert!(!is_valid_key("post:a|b"));
        assert!(put(&p, ClassState::default(), vec![rec(&t, &p, "post:a|b", "x", 1, false)]).is_err());
    }

    #[test]
    fn accepts_a_record_signed_by_the_browser_adapter() {
        // produced by freenet/api.js (WebCrypto Ed25519) for seed 07*32; guards the signed-message format on both sides
        let id = "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c00112233445566778899aabbccddeeff";
        let r = Record {
            data: r#"{"kind":"announcement","body":"hi"}"#.into(),
            updated_at: 1700000000000,
            deleted: false,
            by: id[..64].into(),
            sig: "0589bf84764150c2c3caadca7b300a9119b45162eaa0633abe3fad9e0a816a1d680aa243c5ce7e06820717c0055090297982d98082c85a5a3f67d99ca7025707".into(),
        };
        assert_eq!(pk(&sk(7)), id[..64]);
        assert!(merge(id, ClassState::default(), st(vec![("post:a1".into(), r)])).is_ok());
    }
}
