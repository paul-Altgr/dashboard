/* ==========================================================================
   CONFIGURATION (constantes faciles à modifier)
   ========================================================================== */
const ALLOW_SIGNUP_UI = false;   // true : affiche « Créer mon compte » (inscriptions à autoriser aussi dans Supabase) ; false : masqué, les comptes existants se connectent toujours
const SUPABASE_URL = "https://gdevdnbgshkjyskuscnz.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_M-y34_JtymHy8BpOpTnBZA_6Y791iFO";   // clé publique uniquement
const SITE_URL = "https://paul-altgr.github.io/dashboard/";   // retour des liens e-mail (confirmation, récupération)
const TABLE = "weekly_plans";
const SAVE_DEBOUNCE_MS = 1000, RETRY_MS = 15000;
const SCHEMA = 2, SCHEMAS_OK = [1, 2];   // schéma 2 : types de cartes + lignes récurrentes (quantityKind, defaultCards, repeat, targetLog, columns et rows sont facultatifs : pas de nouveau schéma) ; le schéma 1 reste accepté puis migré
const LEGACY = {plan:'planning39h.v2', hist:'planning39h.history.v1', chk:'planning39h.checklists.v1'};   // clés localStorage d'origine

(function(){
'use strict';
const $ = id => document.getElementById(id);

/* ---------- Cache localStorage (accès « bruts », sans déclencher la synchro) ---------- */
const origSet = Storage.prototype.setItem, origGet = Storage.prototype.getItem, origDel = Storage.prototype.removeItem;
const ls = {get:k => origGet.call(localStorage,k), set:(k,v) => origSet.call(localStorage,k,v), del:k => origDel.call(localStorage,k)};
const readJSON = k => { try{ return JSON.parse(ls.get(k)); }catch(e){ return null; } };
window.CloudSync = {keys:{plan:'', hist:'', chk:''}, ask:ask};   // clés propres à l'utilisateur + boîte de dialogue générique, lues par l'application
let metaKey = '', sb = null, user = null, booted = false, starting = false, recovery = false, busy = false, timer = null, notice = '';
let meta = {dirty:false, base:null, localAt:null};   // dirty : modifications locales non envoyées ; base : updated_at de la dernière synchro
let cloudReady = false;   // true : la dernière réconciliation avec le cloud a abouti (condition pour créer les cartes par défaut)
let reloading = false;    // true : un rechargement de la page est en route (plus aucune création automatique)
let checking = false, conflictP = null, askQueue = Promise.resolve();

/* ---------- Indicateur de synchronisation ---------- */
const STATES = {session:'Vérification de la session…', login:'Connexion nécessaire', loading:'Chargement du planning…',
  saving:'Sauvegarde en cours…', ok:'Synchronisé', offline:'Hors ligne — sauvegardé sur cet appareil',
  pending:'Modifications en attente de synchronisation', error:'Erreur de synchronisation'};
function status(k){ const c = $('syncChip'); c.textContent = STATES[k]; c.className = k === 'ok' ? 'ok' : (['error','pending','offline'].includes(k) ? 'warn' : ''); }
const msg = (id, t) => { $(id).textContent = t || ''; };
function show(v){
  $('loadingView').hidden = v !== 'loading'; $('authView').hidden = v !== 'login';
  document.body.classList.toggle('authed', v === 'app');
  if(v === 'login') status('login');
}
function frErr(e){
  const m = String((e && e.message) || e);
  if(/Invalid login/i.test(m)) return 'E-mail ou mot de passe incorrect.';
  if(/not confirmed/i.test(m)) return 'Adresse e-mail non confirmée : cliquez sur le lien reçu par e-mail.';
  if(/already registered/i.test(m)) return 'Un compte existe déjà avec cette adresse.';
  if(/at least|weak/i.test(m)) return 'Mot de passe trop court ou trop faible (6 caractères minimum).';
  if(/rate limit|too many/i.test(m)) return 'Trop de tentatives : patientez quelques minutes.';
  if(/invalid.*email|valid email/i.test(m)) return 'Adresse e-mail invalide.';
  if(/fetch|network/i.test(m)) return 'Connexion Internet indisponible.';
  return 'Une erreur est survenue : ' + m;
}
const fd = iso => iso ? new Date(iso).toLocaleString('fr-FR') : 'inconnue';

/* ---------- Boîte de dialogue générique : renvoie l'index du bouton (-1 si fermée) ----------
   Les demandes sont mises en file : un dialogue ne peut jamais en écraser un autre encore ouvert. */
function ask(title, text, labels){
  const open = () => new Promise(res => {
    const d = $('cloudDialog'), box = $('cdBtns'); let done = false;
    $('cdTitle').textContent = title; $('cdText').textContent = text; box.innerHTML = '';
    const fin = v => { if(done) return; done = true; d.close(); res(v); };
    labels.forEach((l, i) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = l; b.onclick = () => fin(i); box.appendChild(b); });
    d.oncancel = e => { e.preventDefault(); fin(-1); };
    if(d.open) d.close();
    d.showModal();
  });
  const p = askQueue.then(open);
  askQueue = p.then(() => {}, () => {});
  return p;
}

/* ---------- Format des données, validation, migration, exportation ---------- */
const MOMENTS = ['matin','midi','soir'];
function pack(plan, hist, chk){ return {schema:SCHEMA, app:'planning39h', exportedAt:new Date().toISOString(), plan:plan, history:hist || {}, checklists:chk || {cards:[]}}; }
function snapshot(){ const K = window.CloudSync.keys; return pack(readJSON(K.plan), readJSON(K.hist), readJSON(K.chk)); }
function validChk(c){   // checklists optionnelles (anciens exports sans cette propriété) ; champs facultatifs vérifiés seulement s'ils existent
  if(c === undefined) return true;
  const ok = x => x && typeof x === 'object' && !Array.isArray(x);
  const date = v => v === undefined || (typeof v === 'string' && !isNaN(Date.parse(v)));
  const num = v => v === undefined || Number.isFinite(v);
  const qty = v => v === undefined || v === null || (Number.isFinite(v) && v >= 0);
  const text = v => v === undefined || typeof v === 'string';
  const list = v => v === undefined || Array.isArray(v);
  const kind = v => v === undefined || v === null || ['time','number'].includes(v);   // quantityKind : facultatif (absent dans les anciennes données)
  const rep = v => v === undefined || v === null || (ok(v) && Number.isInteger(v.every) && v.every >= 1 && ['day','week','month','year'].includes(v.unit));   // répétition : facultative (ancien format : frequency)
  const recs = o => o === undefined || (ok(o) && Object.keys(o).every(k => ok(o[k]) && qty(o[k].value) && (o[k].checked === undefined || typeof o[k].checked === 'boolean')));
  const cfg = g => (g.frequency === undefined || g.frequency === null || typeof g.frequency === 'string') && rep(g.repeat) && list(g.targetLog) &&
    (g.trackingMode === undefined || ['check','quantity'].includes(g.trackingMode)) && kind(g.quantityKind) && qty(g.target) && text(g.unit) && recs(g.records);
  const goal = g => ok(g) && typeof g.id === 'string' && g.id && typeof g.name === 'string' && cfg(g) && date(g.createdAt) && date(g.updatedAt) &&
    (g.archivedAt === null || date(g.archivedAt)) && num(g.order) && (g.pauses === undefined || Array.isArray(g.pauses)) &&
    (g.legacy === undefined || (Array.isArray(g.legacy) && g.legacy.every(l => ok(l) && cfg(l))));
  const withId = x => ok(x) && typeof x.id === 'string' && x.id;
  if(!ok(c) || !Array.isArray(c.cards)) return false;
  if(c.defaultCards !== undefined && !ok(c.defaultCards)) return false;   // drapeau des cartes par défaut : facultatif
  return c.cards.every(k => ok(k) && typeof k.id === 'string' && k.id && typeof k.title === 'string' &&
    (k.icon === undefined || typeof k.icon === 'string') && (k.color === undefined || /^#[0-9a-fA-F]{6}$/.test(k.color)) &&
    (k.type === undefined || ['standard','sport','menage','custom'].includes(k.type)) &&   // ancienne carte sans type : acceptée, deviendra « standard »
    (k.goals === undefined || (Array.isArray(k.goals) && k.goals.every(goal))) &&
    (k.columns === undefined || (Array.isArray(k.columns) && k.columns.every(withId))) &&   // cartes paramétrables : colonnes et lignes facultatives
    (k.rows === undefined || (Array.isArray(k.rows) && k.rows.every(r => withId(r) && (r.values === undefined || ok(r.values))))) &&
    date(k.createdAt) && date(k.updatedAt) && num(k.order) && Array.isArray(k.items) &&
    k.items.every(i => ok(i) && typeof i.id === 'string' && i.id && typeof i.text === 'string' && typeof i.checked === 'boolean' && date(i.createdAt) && date(i.updatedAt) && num(i.order)));
}
function valid(d){   // refuse toute structure incompatible ; les données ne sont jamais interprétées comme du HTML/JS
  try{
    if(!d || !SCHEMAS_OK.includes(d.schema) || d.app !== 'planning39h') return false;
    const p = d.plan, h = d.history;
    if(p !== null){
      if(!p || typeof p !== 'object' || typeof p.week !== 'string' || !Number.isFinite(p.done) || !p.locks || typeof p.locks !== 'object') return false;
      if(p.moment !== undefined && !MOMENTS.includes(p.moment)) return false;
      if(p.mode !== undefined && !/^(auto|[0-4])$/.test(String(p.mode))) return false;
    }
    if(!h || typeof h !== 'object' || Array.isArray(h)) return false;
    if(!validChk(d.checklists)) return false;
    return Object.keys(h).every(k => /^\d{4}-\d{1,2}-\d{1,2}$/.test(k) && ['entreprise','ecole'].includes(h[k].type) && Number.isFinite(h[k].goal) && Number.isFinite(h[k].done));
  }catch(e){ return false; }
}
function migrate(d){   // migration explicite et idempotente vers le format actuel (type « standard », lignes récurrentes, frequency → repeat, cartes paramétrables ; champs absents complétés)
  const out = Object.assign({}, d, {schema:SCHEMA});
  if(d.checklists !== undefined && d.checklists !== null) out.checklists = window.ChkModel.normalize(d.checklists);
  return out;
}
function download(obj, prefix){
  const n = new Date(), p = x => String(x).padStart(2,'0'), a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], {type:'application/json'}));
  a.download = prefix + '-' + n.getFullYear() + p(n.getMonth()+1) + p(n.getDate()) + '-' + p(n.getHours()) + p(n.getMinutes()) + '.json';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function applyData(d){   // migre puis écrit dans le cache de l'utilisateur sans déclencher de synchro
  d = migrate(d);
  const k = window.CloudSync.keys;
  if(d.plan === null) ls.del(k.plan); else ls.set(k.plan, JSON.stringify(d.plan));
  ls.set(k.hist, JSON.stringify(d.history || {}));
  if(d.checklists) ls.set(k.chk, JSON.stringify(d.checklists));   // absentes (ancien format) : on garde les checklists locales
}
const saveMeta = () => ls.set(metaKey, JSON.stringify(meta));

/* ---------- Sauvegarde dans Supabase (upsert, une ligne par utilisateur) ---------- */
async function fetchRemote(){
  const {data, error} = await sb.from(TABLE).select('data,updated_at').eq('user_id', user.id).maybeSingle();
  if(error) throw error;
  return data;   // null si aucune ligne
}
async function pushNow(force){   // renvoie false uniquement si un conflit a été détecté et n'a pas été résolu
  if(!user || busy) return;
  clearTimeout(timer);
  if(!navigator.onLine){ status('offline'); return; }
  busy = true; status('saving');
  const stamp = meta.localAt;
  try{
    if(!force){   // avant d'envoyer : la version en ligne a-t-elle changé depuis notre dernière synchro ?
      const r = await fetchRemote();
      if(r && Date.parse(r.updated_at) !== (meta.base ? Date.parse(meta.base) : null)){ busy = false; return conflict(r); }
    }
    const {data, error} = await sb.from(TABLE).upsert({user_id:user.id, data:snapshot(), updated_at:new Date().toISOString()}, {onConflict:'user_id'}).select('updated_at').single();
    if(error) throw error;
    meta.base = data.updated_at; if(meta.localAt === stamp) meta.dirty = false; saveMeta();   // succès confirmé par Supabase
    status(meta.dirty ? 'pending' : 'ok');
    if(meta.dirty) timer = setTimeout(() => pushNow(), SAVE_DEBOUNCE_MS);
  }catch(e){
    status(navigator.onLine ? 'error' : 'offline');
    timer = setTimeout(() => pushNow(), RETRY_MS);   // nouvel essai automatique
  }finally{ busy = false; }
}
function onLocalChange(){   // 1) cache local déjà écrit par l'application, 2) synchro différée
  meta.dirty = true; meta.localAt = new Date().toISOString(); saveMeta();
  status(navigator.onLine ? 'pending' : 'offline');
  clearTimeout(timer); timer = setTimeout(() => pushNow(), SAVE_DEBOUNCE_MS);
}
Storage.prototype.setItem = function(k, v){
  const prev = origGet.call(this, k);
  origSet.call(this, k, v);
  const K = window.CloudSync.keys;
  if(booted && this === localStorage && prev !== v && (k === K.plan || k === K.hist || k === K.chk)) onLocalChange();
};

/* ---------- Gestion des conflits ---------- */
function conflict(r){   // un seul dialogue de conflit à la fois ; renvoie true si le conflit est résolu (sans rechargement en cours)
  if(!conflictP) conflictP = resolveConflict(r).finally(() => { conflictP = null; });
  return conflictP;
}
async function resolveConflict(r){
  status('pending');
  const c = await ask('Conflit de synchronisation',
    'Version de cet appareil : modifiée le ' + fd(meta.localAt) + '. Version en ligne : modifiée le ' + fd(r.updated_at) + '. Laquelle voulez-vous garder ?',
    ['Conserver la version de cet appareil', 'Utiliser la version en ligne', 'Annuler et exporter une sauvegarde']);
  if(c === 0){ await pushNow(true); return true; }
  if(c === 1){
    if(!valid(r.data)){ status('error'); return false; }
    download(snapshot(), 'planning-sauvegarde-appareil');   // filet de sécurité avant remplacement
    applyData(r.data); meta.base = r.updated_at; meta.dirty = false; saveMeta();
    if(booted){ reloading = true; location.reload(); return false; }
    status('ok'); return true;
  }
  download(snapshot(), 'planning-sauvegarde');
  return false;
}

/* ---------- Chargement depuis Supabase et réconciliation ---------- */
async function reconcile(){   // renvoie false si l'utilisateur annule ou si la page se recharge ; met à jour cloudReady
  cloudReady = false;
  const r = await fetchRemote();
  if(!r){
    if(!booted){ const ok = await firstTime(); cloudReady = ok; return ok; }
    cloudReady = !meta.dirty || (await pushNow()) !== false;
    return true;
  }
  const rt = Date.parse(r.updated_at), bt = meta.base ? Date.parse(meta.base) : null;
  if(bt === null && readJSON(window.CloudSync.keys.plan) && !meta.dirty){ meta.dirty = true; meta.localAt = new Date().toISOString(); }   // jamais écraser des données locales jamais synchronisées
  if(!meta.dirty){
    if(rt !== bt){
      if(!valid(r.data)){ status('error'); return true; }
      applyData(r.data); meta.base = r.updated_at; saveMeta();
      if(booted){ reloading = true; location.reload(); return false; }
    }
    status('ok'); cloudReady = true; return true;
  }
  if(rt !== bt) cloudReady = await conflict(r);
  else cloudReady = (await pushNow()) !== false;
  return true;
}

/* ---------- Cartes par défaut (Sport, Ménage, Devoirs) ----------
   Créées une seule fois, uniquement quand : l'application est démarrée (l'écriture est alors synchronisée),
   la réconciliation avec le cloud a abouti (pas de doublon entre deux appareils) et aucun rechargement n'est en route. */
function seedDefaults(){
  if(!booted || !cloudReady || reloading || !window.Checklists) return;
  try{ window.Checklists.ensureDefaults(); }catch(e){}
}

/* ---------- Migration des anciennes données localStorage ---------- */
function candidate(){   // données locales : cache de l'utilisateur, sinon clés d'origine (jamais supprimées)
  const K = window.CloudSync.keys;
  for(const [pk, hk, ck] of [[K.plan, K.hist, K.chk], [LEGACY.plan, LEGACY.hist, LEGACY.chk]]){
    const plan = readJSON(pk), hist = readJSON(hk) || {}, chk = readJSON(ck);
    if((plan || Object.keys(hist).length || (chk && chk.cards && chk.cards.length)) && valid(pack(plan, hist, chk))) return {plan:plan, hist:hist, chk:chk};
  }
  return null;
}
async function firstTime(){   // aucune ligne en ligne pour cet utilisateur
  const cand = candidate(), K = window.CloudSync.keys;
  if(!cand){ meta = {dirty:true, base:null, localAt:new Date().toISOString()}; saveMeta(); return true; }   // nouveau compte : création de la ligne après démarrage
  const c = await ask('Données locales trouvées', 'Des données locales ont été trouvées sur cet appareil. Voulez-vous les envoyer vers votre compte en ligne ?',
    ['Importer les données locales vers le cloud', 'Commencer avec un planning vide', 'Annuler']);
  if(c === 0){
    download(pack(cand.plan, cand.hist, cand.chk), 'planning-sauvegarde-locale');   // sauvegarde avant envoi
    applyData({plan:cand.plan, history:cand.hist, checklists:cand.chk});
    meta = {dirty:true, base:null, localAt:new Date().toISOString()}; saveMeta();
    await pushNow(true);
    notice = meta.dirty ? 'La sauvegarde en ligne a échoué : vos données locales sont conservées et seront renvoyées.' : 'Données locales importées vers votre compte.';
    return true;
  }
  if(c === 1){
    download(pack(cand.plan, cand.hist, cand.chk), 'planning-sauvegarde-locale');
    ls.del(K.plan); ls.del(K.hist); ls.del(K.chk);   // uniquement le cache de ce compte ; les clés d'origine restent intactes
    meta = {dirty:true, base:null, localAt:new Date().toISOString()}; saveMeta();
    return true;
  }
  await sb.auth.signOut(); return false;
}

/* ---------- Session : démarrage de l'application ---------- */
async function start(u){
  if(starting || booted) return;
  starting = true; user = u;
  const K = window.CloudSync.keys;
  K.plan = LEGACY.plan + '.u.' + u.id; K.hist = LEGACY.hist + '.u.' + u.id; K.chk = LEGACY.chk + '.u.' + u.id; metaKey = 'planning39h.sync.u.' + u.id;   // cache séparé par compte
  meta = Object.assign({dirty:false, base:null, localAt:null}, readJSON(metaKey));
  show('loading'); status('loading');
  try{
    if(!(await reconcile())){ starting = false; show('login'); return; }
  }catch(e){   // hors ligne ou erreur réseau : on utilise le cache de ce compte (les cartes par défaut attendront une réconciliation réussie)
    cloudReady = false;
    if(!(readJSON(K.plan) || readJSON(K.hist))){
      starting = false; show('login'); status(navigator.onLine ? 'error' : 'offline');
      msg('authMsg', 'Connexion Internet nécessaire pour charger votre planning la première fois sur cet appareil.'); return;
    }
    status(navigator.onLine ? 'error' : 'offline');
  }
  $('acctUser').textContent = u.email || '';
  window.bootChecklists(); window.bootPlanning(); window.bootHistory();   // l'application démarre seulement ici
  booted = true; starting = false; show('app');
  if(notice) msg('acctMsg', notice);
  seedDefaults();   // après « booted » : la création des cartes par défaut est enregistrée ET marquée à synchroniser
  if(meta.dirty) pushNow();
}

/* ---------- Authentification ---------- */
function init(){
  if(!ALLOW_SIGNUP_UI) $('btnSignup').hidden = true;
  status('session');
  if(!window.supabase){ show('login'); msg('authMsg', 'Impossible de charger Supabase (connexion Internet requise).'); status('error'); return; }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}});
  const creds = () => ({email:$('authEmail').value.trim(), password:$('authPass').value});

  sb.auth.onAuthStateChange((ev, session) => setTimeout(() => {   // setTimeout : pas d'appel Supabase dans le callback
    if(ev === 'PASSWORD_RECOVERY'){ recovery = true; show('login'); $('authForm').hidden = true; $('recForm').hidden = false; return; }
    if(session && !recovery) start(session.user);
    else if(!session && booted) location.reload();   // déconnexion : tout est vidé de la mémoire
    else if(!session){ show('login'); }
  }, 0));

  $('authForm').onsubmit = async e => {
    e.preventDefault(); const c = creds();
    if(!c.email || !c.password) return msg('authMsg', 'Saisissez votre adresse e-mail et votre mot de passe.');
    msg('authMsg', 'Connexion…');
    const {error} = await sb.auth.signInWithPassword(c);
    msg('authMsg', error ? frErr(error) : ''); $('authPass').value = '';
  };
  $('btnSignup').onclick = async () => {
    const c = creds(); if(!c.email || !c.password) return msg('authMsg', 'Saisissez une adresse e-mail et un mot de passe.');
    const {data, error} = await sb.auth.signUp({email:c.email, password:c.password, options:{emailRedirectTo:SITE_URL}});
    msg('authMsg', error ? frErr(error) : (data.session ? '' : 'Compte créé. Cliquez sur le lien de confirmation reçu par e-mail, puis connectez-vous.'));
  };
  $('btnReset').onclick = async () => {
    const em = $('authEmail').value.trim(); if(!em) return msg('authMsg', 'Saisissez d’abord votre adresse e-mail.');
    const {error} = await sb.auth.resetPasswordForEmail(em, {redirectTo:SITE_URL});
    msg('authMsg', error ? frErr(error) : 'Si un compte existe pour cette adresse, un e-mail de récupération vient d’être envoyé.');
  };
  $('recForm').onsubmit = async e => {
    e.preventDefault();
    const {error} = await sb.auth.updateUser({password:$('recPass').value});
    if(error) return msg('authMsg', frErr(error));
    recovery = false; $('recForm').hidden = true; $('authForm').hidden = false; msg('authMsg', '');
    const {data} = await sb.auth.getUser(); if(data && data.user) start(data.user);
  };
  $('btnLogout').onclick = async () => {   // ne supprime aucune donnée (ni locale, ni en ligne)
    if(meta.dirty && !navigator.onLine && !confirm('Des modifications ne sont pas encore synchronisées. Elles restent sur cet appareil jusqu’à votre prochaine connexion. Se déconnecter ?')) return;
    if(meta.dirty && navigator.onLine) await pushNow();
    document.body.classList.remove('authed');
    await sb.auth.signOut(); location.reload();
  };

  /* ---------- Exportation / importation JSON ---------- */
  $('btnExport').onclick = () => { download(snapshot(), 'planning-export'); msg('acctMsg', 'Export téléchargé.'); };
  $('btnImport').onclick = () => $('fileImport').click();
  $('fileImport').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if(!f) return;
    if(!/\.json$/i.test(f.name)) return msg('acctMsg', 'Fichier refusé : seul un fichier .json est accepté.');
    let d; try{ d = JSON.parse(await f.text()); }catch(err){ return msg('acctMsg', 'Fichier refusé : JSON invalide.'); }
    if(!valid(d)) return msg('acctMsg', 'Fichier refusé : ce n’est pas une sauvegarde de ce planning.');
    d = migrate(d);   // anciens exports (schéma 1, cartes sans type, sans Sport ni Ménage, sans quantityKind, avec frequency au lieu de repeat) : migrés puis revalidés
    if(!valid(d)) return msg('acctMsg', 'Fichier refusé : la sauvegarde n’a pas pu être migrée vers le format actuel.');
    if(await ask('Remplacer les données ?', 'Les données actuelles seront remplacées par le contenu du fichier. Une sauvegarde des données actuelles sera téléchargée avant.', ['Remplacer mes données', 'Annuler']) !== 0) return;
    download(snapshot(), 'planning-sauvegarde-avant-import');
    reloading = true;   // la page va se recharger : plus aucune création automatique d'ici là
    applyData(d); meta.dirty = true; meta.localAt = new Date().toISOString(); saveMeta();
    await pushNow(true);
    msg('acctMsg', meta.dirty ? 'Import enregistré sur cet appareil ; la synchronisation en ligne reprendra automatiquement.' : 'Import réussi et synchronisé.');
    setTimeout(() => location.reload(), 1200);   // recharge l'application avec les données importées
  };

  /* ---------- Hors ligne / retour d'Internet / retour sur la page ---------- */
  const check = async () => {   // une seule réconciliation à la fois ; les cartes par défaut en attente sont créées après une réconciliation réussie
    if(!booted || !user || !navigator.onLine || checking || reloading) return;
    checking = true;
    try{ if(await reconcile()) seedDefaults(); }
    catch(e){ status('error'); }
    finally{ checking = false; }
  };
  document.addEventListener('visibilitychange', () => { if(!document.hidden) check(); });
  window.addEventListener('online', check);
  window.addEventListener('offline', () => { if(booted) status('offline'); });
}
init();
})();