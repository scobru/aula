// English text is the key; a missing Italian entry falls back to English.
const IT = {
  // shell
  'Classes': 'Classi', 'Work': 'Compiti', 'Calendar': 'Calendario', 'Notifications': 'Notifiche', 'Log out': 'Esci', 'Home': 'Home',
  'Name': 'Nome', 'Username': 'Nome utente', 'Password (min 8 characters)': 'Password (min 8 caratteri)', 'Create account': 'Crea account', 'Log in': 'Accedi',
  'Have an account? Log in': 'Hai un account? Accedi', 'New here? Register': 'Nuovo? Registrati',
  // home
  'Your classes': 'Le tue classi', 'No classes yet.': 'Ancora nessuna classe.', 'Archived ({n})': 'Archiviate ({n})', 'Create a class': 'Crea una classe',
  'Join with a code': 'Entra con un codice', 'Class name': 'Nome della classe', 'Code': 'Codice', 'Go': 'Vai', 'teacher': 'docente', 'student': 'studente',
  // work / calendar / notifications
  'due {d}': 'scadenza {d}', 'Grade: {g}': 'Voto: {g}', '{n} to return': '{n} da restituire', 'To return': 'Da restituire', 'Late': 'In ritardo', 'To do': 'Da fare', 'Done': 'Completati',
  'Nothing to do.': 'Niente da fare.', 'No due dates.': 'Nessuna scadenza.', 'No notifications.': 'Nessuna notifica.',
  'New in {class}: {title}': 'Novità in {class}: {title}', '{student} turned in "{title}"': '{student} ha consegnato "{title}"',
  'Your work "{title}" was returned': 'Il tuo lavoro "{title}" è stato restituito', '{user} commented on "{title}"': '{user} ha commentato "{title}"',
  '{user} sent a private comment on "{title}"': '{user} ha scritto un commento privato su "{title}"',
  // profile
  'Profile': 'Profilo', 'Save': 'Salva', 'Change password': 'Cambia password', 'Current password': 'Password attuale', 'New password (min 8 characters)': 'Nuova password (min 8 caratteri)', 'Password changed': 'Password cambiata',
  // class
  '(archived)': '(archiviata)', 'Stream': 'Bacheca', 'People': 'Persone', 'Grades': 'Voti', 'Settings': 'Impostazioni',
  'Announcement': 'Annuncio', 'Assignment': 'Compito', 'Quiz': 'Quiz', 'Material': 'Materiale', 'Type': 'Tipo', 'Title': 'Titolo', 'Text': 'Testo',
  'Topic (optional)': 'Argomento (facoltativo)', 'Topic': 'Argomento', 'All topics': 'Tutti gli argomenti', 'Due': 'Scadenza', 'Points': 'Punti', 'Publish later': 'Pubblica più tardi', 'Post': 'Pubblica',
  'Question': 'Domanda', 'Options, one per line': 'Opzioni, una per riga', 'Correct option number': 'Numero dell\'opzione corretta', 'Add question': 'Aggiungi domanda', 'Remove': 'Rimuovi',
  'assigned': 'assegnato', 'returned': 'restituito', 'turned in': 'consegnato', 'draft': 'bozza', '{n} pts': '{n} pt', 'scheduled for {d}': 'programmato per {d}', '{n} comments': '{n} commenti',
  'Leave class': 'Esci dalla classe', 'Leave this class?': 'Uscire da questa classe?', 'Remove {name} from the class?': 'Rimuovere {name} dalla classe?',
  'Reset password': 'Reimposta password', 'Reset the password of {name}? They will be signed out everywhere.': 'Reimpostare la password di {name}? Verrà disconnesso da ovunque.',
  'Username: {u}\nTemporary password: {p}\nTell them to change it in Profile. It is shown only once.': 'Nome utente: {u}\nPassword temporanea: {p}\nDigli di cambiarla dal Profilo. Viene mostrata una sola volta.',
  'Only students can be reset': 'Si possono reimpostare solo gli studenti', 'This student is also in classes you do not teach': 'Questo studente è anche in classi che non insegni',
  'Download CSV': 'Scarica CSV', '* graded but not returned yet': '* valutato ma non ancora restituito', 'Student': 'Studente', 'No assignments yet.': 'Ancora nessun compito.',
  'Student code': 'Codice studenti', 'Co-teacher code': 'Codice co-docenti', 'Rename': 'Rinomina', 'Archive': 'Archivia', 'Unarchive': 'Ripristina',
  'Delete class': 'Elimina classe', 'Delete this class and everything in it?': 'Eliminare questa classe e tutto il suo contenuto?',
  // post
  'Write a comment': 'Scrivi un commento', 'Send': 'Invia', 'Submit your answers? You can only do this once.': 'Inviare le risposte? Si può fare una sola volta.', 'Submit answers': 'Invia risposte',
  'Edit': 'Modifica', 'Delete': 'Elimina', 'Delete this post?': 'Eliminare questo post?', '< Back to class': '< Torna alla classe', 'Class comments': 'Commenti della classe', 'Private comments': 'Commenti privati',
  'Your work': 'Il tuo lavoro', 'Your answer': 'La tua risposta', 'turned in {d}': 'consegnato il {d}', 'not turned in': 'non consegnato', 'Resubmit': 'Consegna di nuovo', 'Turn in': 'Consegna',
  'Unsubmit': 'Ritira consegna', 'Save draft': 'Salva bozza', 'Grade': 'Voto', 'Feedback': 'Feedback', 'Returned': 'Restituito', '(late)': '(in ritardo)',
  'Submissions ({n})': 'Consegne ({n})', 'Return all graded': 'Restituisci tutti i valutati', '{n} returned': '{n} restituiti', 'Nothing turned in yet.': 'Nessuna consegna.', 'Download failed': 'Download non riuscito',
  // server messages
  'Not found': 'Non trovato', 'Teachers only': 'Solo per i docenti', 'Login required': 'Accesso richiesto', 'Invalid username or password': 'Nome utente o password errati',
  'Too many attempts, try again later': 'Troppi tentativi, riprova più tardi', 'Registration is closed': 'Le registrazioni sono chiuse', 'Username already taken': 'Nome utente già in uso',
  'Name, username (3-32 letters, digits, . _ -) and password (min 8 chars) required': 'Servono nome, nome utente (3-32 tra lettere, cifre, . _ -) e password (min 8 caratteri)', 'Name required': 'Nome obbligatorio', 'Wrong current password': 'Password attuale errata',
  'Password must be at least 8 characters': 'La password deve avere almeno 8 caratteri', 'Class name required': 'Nome della classe obbligatorio', 'No class with that code': 'Nessuna classe con quel codice',
  'Class is archived': 'La classe è archiviata', 'Only the class owner can delete it': 'Solo il proprietario può eliminare la classe', 'The owner cannot leave; delete the class instead': 'Il proprietario non può uscire: elimina la classe',
  'Not allowed': 'Non consentito', 'Invalid post type': 'Tipo di post non valido', 'Text required': 'Testo obbligatorio', 'Title required': 'Titolo obbligatorio', 'Invalid due date': 'Scadenza non valida',
  'Invalid publish date': 'Data di pubblicazione non valida', 'Invalid points': 'Punti non validi', 'Invalid grade': 'Voto non valido', 'Invalid answers': 'Risposte non valide', 'A quiz needs 1 to 50 questions': 'Un quiz ha da 1 a 50 domande',
  'Each question needs text, 2-8 non-empty options and a valid correct answer': 'Ogni domanda richiede testo, 2-8 opzioni non vuote e una risposta corretta valida',
  'Only students can submit to assignments': 'Solo gli studenti possono consegnare', 'Only students can take a quiz': 'Solo gli studenti possono fare il quiz', 'Already returned': 'Già restituito', 'Already submitted': 'Già inviato',
  'Not an assignment': 'Non è un compito', 'Not your file': 'Non è un tuo file', 'File too large': 'File troppo grande', 'Invalid JSON': 'JSON non valido', 'Body too large': 'Richiesta troppo grande', 'Server error': 'Errore del server',
};

let lang = 'en';
try { lang = localStorage.getItem('aula-lang') || ''; } catch {}
if (lang !== 'it' && lang !== 'en') lang = (navigator.language || 'en').startsWith('it') ? 'it' : 'en';

const set = l => { lang = l; try { localStorage.setItem('aula-lang', l); } catch {} };
const t = (s, vars) => {
  let r = (lang === 'it' && IT[s]) || s;
  for (const k in vars) r = r.replaceAll('{' + k + '}', vars[k]);
  return r;
};
const stamp = (iso, opts) => new Date(iso).toLocaleString(lang, opts);
const day = iso => new Date(iso).toLocaleDateString(lang, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
// ISO -> value for <input type=datetime-local>
const local = iso => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

// `lang` is a live binding, so importers always see the current language
export { lang, set as setLang, t, stamp as when, day, local, IT };
