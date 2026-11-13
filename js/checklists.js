/* ==========================================================================
   Onglet Checklists (cartes Standard / Paramétrable / Sport / Ménage) et Dashboards Sport / Ménage / Devoirs.
   Données (clé window.CloudSync.keys.chk, synchronisées par la couche Supabase) — tous les champs récents sont facultatifs :
   {defaultCards:{sport,menage,devoirs},                                         // cartes par défaut déjà créées (une seule fois, jamais recréées)
    cards:[{id,type,title,icon,color,createdAt,updatedAt,order,                  // type : 'standard' | 'sport' | 'menage' | 'custom'
     items:[{id,text,checked,createdAt,updatedAt,order}],                        // lignes standard
     goals:[{id,name,repeat:{every,unit},frequency,trackingMode,quantityKind,target,unit,active,archivedAt,createdAt,updatedAt,order,
             // repeat.unit : 'day' | 'week' | 'month' | 'year' ; frequency ('daily' | 'weekly') : ancien champ, toujours lu, écrit quand il reste représentable
             since,                                                              // jour local de début de la configuration actuelle (ancre des blocs de N jours)
             pauses:[{from,to}], targetLog:[{until,target,unit}],                // archivages ; anciens objectifs (valables pour les périodes commençant avant « until »)
             legacy:[{repeat,frequency,trackingMode,quantityKind,target,unit,from,to,records,targetLog}],
             records:{'YYYY-MM-DD':{value,checked,targetAtTime,unitAtTime,updatedAt}}}],   // clé = premier jour local de la période
     // cartes paramétrables (type 'custom') :
     preset,                                                                     // 'devoirs' pour la carte Devoirs
     columns:[{id,name,type,options:[{id,name,color}],order,unit,role,quick,def}],
     rows:[{id,values:{<id de colonne>:valeur},createdAt,updatedAt,order,doneAt,anchorDay,log:[{at,due}]}]}]}
   L'historique est relié aux identifiants, jamais aux noms. Tous les textes sont insérés via textContent / value.
   ========================================================================== */
(function(){
  'use strict';
  var EMOJIS = ['🛒','🧹','🧺','🏠','📚','💼','✅','📝','🧳','🍽️','🛠️','❤️','🎯','📦','🐾','🏋️','🏃'];
  var COLORS = ['#1f6f5c','#2f6fdb','#8a4fd1','#d1457a','#d9822b','#c9a227','#3a9d5d','#5f6f6a'];
  var PAL = ['#2f6fdb','#d9822b','#8a4fd1','#3a9d5d','#d1457a','#c9a227','#1aa6b7','#8d6e63','#5c6bc0','#e0564a'];
  var HEX = /^#[0-9a-fA-F]{6}$/, DKEY = /^\d{4}-\d{2}-\d{2}$/, NS = 'http://www.w3.org/2000/svg';
  var TYPES = ['standard','sport','menage','custom'], TYPELBL = {standard:'Standard', sport:'Sport', menage:'Ménage', custom:'Paramétrable'};
  var KINDS = ['check','time','number'], KIND = {check:'simple case', time:'temps', number:'nombre'};
  var UNITS = ['day','week','month','year'], UL = {day:['jour','jours','j'], week:['semaine','semaines','sem.'], month:['mois','mois','mois'], year:['an','ans','an']};
  var COLT = {text:'Texte', longtext:'Texte long', number:'Nombre', checkbox:'Case à cocher', date:'Date', select:'Liste déroulante', multi:'Étiquettes', repeat:'Répétition', priority:'Priorité', link:'Lien'};
  var PRIO = {1:{name:'Basse', color:'#3a9d5d'}, 2:{name:'Moyenne', color:'#c9a227'}, 3:{name:'Haute', color:'#d1457a'}};
  var PRMAP = {basse:1, faible:1, moyenne:2, normale:2, haute:3, 'élevée':3};
  /* Cartes créées UNE SEULE FOIS par défaut (voir ensureDefaults). Simples données de départ, modifiables ensuite.
     Ligne = [titre, unité de répétition, type d'objectif, objectif, unité]. */
  var DEFAULT_CARDS = [
    {type:'sport', title:'Sport', icon:'🏋️', color:'#2f6fdb', lines:[
      ['Courir','week','time',20,''], ['Marche','day','time',30,''], ['Pompes','day','number',30,'répétitions'],
      ['Étirements','day','check',null,''], ['Séances de sport','week','number',3,'séances']]},
    {type:'menage', title:'Ménage', icon:'🧹', color:'#3a9d5d', lines:[
      ['Vaisselle','day','check',null,''], ['Ranger','day','time',10,''], ['Aspirateur','week','check',null,''],
      ['Lessive','week','number',2,''], ['Salle de bain','week','check',null,''], ['Changer les draps','week','check',null,'']]}
  ];

  function now(){ return new Date().toISOString(); }   // horodatage technique uniquement (jamais utilisé pour calculer un jour ou une semaine)
  function uid(){
    if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);   // secours
  }
  function has(o, k){ return Object.prototype.hasOwnProperty.call(o, k); }
  function str(v, d){ return typeof v === 'string' ? v : d; }
  function iso(v){ return typeof v === 'string' && !isNaN(Date.parse(v)) ? v : now(); }
  function isObj(x){ return !!x && typeof x === 'object' && !Array.isArray(x); }
  function okNum(v){ return Number.isFinite(v) && v >= 0; }
  function byOrder(a, b){ return a.order - b.order; }
  function num(v){ return String(Math.round(v * 100) / 100).replace('.', ','); }
  function dict(){ return Object.create(null); }
  function fmtMin(v){   // durée en minutes → « 20 min », « 1 h 05 », « 2 h »
    v = Math.round(v);
    var h = Math.floor(v / 60), m = v % 60;
    return h ? h + ' h' + (m ? ' ' + String(m).padStart(2, '0') : '') : m + ' min';
  }
  function kindOf(x){ return x.trackingMode !== 'quantity' ? 'check' : (x.quantityKind === 'time' ? 'time' : 'number'); }

  /* ---- Dates LOCALES uniquement (jamais toISOString / UTC) ---- */
  function dkey(d){ return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
  function pdate(k){ var p = k.split('-'); return new Date(+p[0], +p[1]-1, +p[2]); }
  function addDays(k, n){ var d = pdate(k); d.setDate(d.getDate() + n); return dkey(d); }
  function diffDays(a, b){ return Math.round((pdate(b) - pdate(a)) / 864e5); }
  function mondayKey(d){ var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay()+6) % 7)); return dkey(x); }
  function mondayOfKey(k){ return mondayKey(pdate(k)); }
  function ymOf(k){ return +k.slice(0, 4) * 12 + (+k.slice(5, 7) - 1); }
  function ymKey(n){ return Math.floor(n / 12) + '-' + String(n % 12 + 1).padStart(2, '0') + '-01'; }
  function dfmt(k, o){ return pdate(k).toLocaleDateString('fr-FR', o); }
  function addMonthsClamp(k, n, day){   // le 31 retombe sur le dernier jour du mois
    var p = pdate(k), t = p.getFullYear() * 12 + p.getMonth() + n, y = Math.floor(t / 12), m = t % 12;
    return dkey(new Date(y, m, Math.min(day || p.getDate(), new Date(y, m + 1, 0).getDate())));
  }
  function nextOcc(k, rp, day){ return rp.unit === 'day' ? addDays(k, rp.every) : rp.unit === 'week' ? addDays(k, 7 * rp.every) : addMonthsClamp(k, rp.unit === 'year' ? 12 * rp.every : rp.every, day); }

  /* ---- Répétition : {every:N, unit:'day'|'week'|'month'|'year'} ---- */
  function isRep(r){ return isObj(r) && Number.isInteger(r.every) && r.every >= 1 && r.every <= 999 && UNITS.indexOf(r.unit) >= 0; }
  function repOf(o){ return isRep(o.repeat) ? {every: o.repeat.every, unit: o.repeat.unit} : {every: 1, unit: o.frequency === 'weekly' ? 'week' : 'day'}; }   // ancien champ frequency toujours lu
  function sameRep(a, b){ return a.every === b.every && a.unit === b.unit; }
  function repLbl(r){
    if(!isRep(r)) return 'Ne pas répéter';
    return r.every === 1 ? {day:'Chaque jour', week:'Chaque semaine', month:'Chaque mois', year:'Chaque année'}[r.unit] : 'Tous les ' + r.every + ' ' + UL[r.unit][1];
  }
  function repShort(r){ return r.every + ' ' + UL[r.unit][2] + (r.unit === 'year' && r.every > 1 ? 's' : ''); }
  function withFreq(o){   // garde l'ancien champ frequency quand il reste représentable
    var r = o.repeat;
    if(r.every === 1 && r.unit === 'day') o.frequency = 'daily'; else if(r.every === 1 && r.unit === 'week') o.frequency = 'weekly'; else delete o.frequency;
    return o;
  }

  /* ---- Périodes d'une série s = {rp, from…} : blocs de N jours ancrés sur s.from, semaines à partir du lundi, mois et années calendaires.
     La clé d'une période est son premier jour local. ---- */
  function pkey(s, d){
    var k = typeof d === 'string' ? d : dkey(d), n = s.rp.every, u = s.rp.unit, a;
    if(u === 'day') return n === 1 ? k : addDays(s.from, Math.floor(diffDays(s.from, k) / n) * n);
    if(u === 'week'){ k = mondayOfKey(k); if(n === 1) return k; a = mondayOfKey(s.from); return addDays(a, Math.floor(diffDays(a, k) / (7 * n)) * 7 * n); }
    var step = u === 'year' ? 12 * n : n, base = u === 'year' ? +s.from.slice(0, 4) * 12 : ymOf(s.from);
    return ymKey(base + Math.floor((ymOf(k) - base) / step) * step);
  }
  function pnext(s, k){ var n = s.rp.every, u = s.rp.unit; return u === 'day' ? addDays(k, n) : u === 'week' ? addDays(k, 7 * n) : ymKey(ymOf(k) + (u === 'year' ? 12 * n : n)); }
  function pend(s, k){ return addDays(pnext(s, k), -1); }   // dernier jour de la période
  function plist(s, td){   // périodes de la série, du début de la configuration à aujourd'hui (jamais dans le futur)
    var out = [], k = pkey(s, s.from), last = pkey(s, td), end = s.to ? pkey(s, s.to) : last;
    if(end > last) end = last;
    while(k <= end && out.length < 20000){ out.push(k); k = pnext(s, k); }
    return out;
  }
  function plabel(s, k){
    var u = s.rp.unit, o = {day:'numeric', month:'short'};
    if(+k.slice(0, 4) !== new Date().getFullYear()) o.year = 'numeric';
    if(s.rp.every === 1){
      if(u === 'day'){ o.weekday = 'short'; return dfmt(k, o); }
      if(u === 'week') return 'Sem. du ' + dfmt(k, o);
      if(u === 'month') return dfmt(k, {month:'long', year:'numeric'});
      return k.slice(0, 4);
    }
    return dfmt(k, o) + ' → ' + dfmt(pend(s, k), o);
  }

  /* ---- Migration / normalisation : tolérante et idempotente (complète ce qui manque, conserve les propriétés inconnues) ---- */
  function normRecs(recs, cfg){
    var out = {};
    if(isObj(recs)) Object.keys(recs).forEach(function(k){
      var r = recs[k]; if(!isObj(r)) return;
      var o = Object.assign({}, r, {value: okNum(r.value) ? r.value : null, checked: r.checked === true});
      if(cfg.trackingMode === 'quantity'){   // fige la cible et l'unité de l'époque si elles n'étaient pas enregistrées
        if(!(r.targetAtTime === null || okNum(r.targetAtTime))) o.targetAtTime = cfg.target;
        if(typeof r.unitAtTime !== 'string') o.unitAtTime = cfg.unit;
      }
      out[k] = o;
    });
    return out;
  }
  function firstKey(recs){ return Object.keys(recs).filter(function(k){ return DKEY.test(k); }).sort()[0]; }
  function normCfg(i){   // champs communs à une ligne et à une ancienne configuration ; frequency 'daily' / 'weekly' → repeat
    var c = {repeat: repOf(i), trackingMode: i.trackingMode === 'quantity' ? 'quantity' : 'check', target: okNum(i.target) ? i.target : null, unit: str(i.unit, ''),
      targetLog: (Array.isArray(i.targetLog) ? i.targetLog : []).filter(function(t){ return isObj(t) && DKEY.test(t.until); })
        .map(function(t){ return Object.assign({}, t, {target: okNum(t.target) ? t.target : null, unit: str(t.unit, '')}); })};
    if(c.trackingMode === 'quantity') c.quantityKind = i.quantityKind === 'time' ? 'time' : 'number';
    return c;
  }
  function normGoal(i, k){
    var g = withFreq(Object.assign({}, i, normCfg(i), {id: str(i.id, '') || uid(), name: str(i.name, 'Sans nom'),
      archivedAt: typeof i.archivedAt === 'string' && !isNaN(Date.parse(i.archivedAt)) ? i.archivedAt : null,
      createdAt: iso(i.createdAt), updatedAt: iso(i.updatedAt), order: Number.isFinite(i.order) ? i.order : k,
      pauses: (Array.isArray(i.pauses) ? i.pauses : []).filter(function(p){ return isObj(p) && DKEY.test(p.from) && (p.to == null || DKEY.test(p.to)); })}));
    g.active = !g.archivedAt;
    g.records = normRecs(i.records, g);
    var today = dkey(new Date()), created = dkey(new Date(g.createdAt)), first = firstKey(g.records);
    g.since = DKEY.test(i.since) ? i.since : (first && first < created ? first : created);
    g.legacy = (Array.isArray(i.legacy) ? i.legacy : []).filter(isObj).map(function(l){
      var s = withFreq(Object.assign({}, l, normCfg(l)));
      s.records = normRecs(l.records, s);
      s.to = DKEY.test(l.to) ? l.to : today;
      s.from = DKEY.test(l.from) ? l.from : (firstKey(s.records) || s.to);
      return s;
    });
    if(g.archivedAt && !g.pauses.some(function(p){ return !p.to; })) g.pauses.push({from: dkey(new Date(g.archivedAt)), to: null});
    return g;
  }
  function normItem(i, k){
    return Object.assign({}, i, {id: str(i.id, '') || uid(), text: str(i.text, ''), checked: i.checked === true,
      createdAt: iso(i.createdAt), updatedAt: iso(i.updatedAt), order: Number.isFinite(i.order) ? i.order : k});
  }
  function normOpt(o){ return Object.assign({}, o, {id: str(o.id, '') || uid(), name: str(o.name, ''), color: HEX.test(o.color) ? o.color : COLORS[0]}); }
  function normCol(c, k){
    return Object.assign({}, c, {id: str(c.id, '') || uid(), name: str(c.name, '') || 'Colonne', type: has(COLT, c.type) ? c.type : 'text',
      order: Number.isFinite(c.order) ? c.order : k, options: (Array.isArray(c.options) ? c.options : []).filter(isObj).map(normOpt)});
  }
  function normRow(r, k){   // les valeurs sont conservées telles quelles (une valeur incompatible reste affichée comme « valeur d'origine »)
    return Object.assign({}, r, {id: str(r.id, '') || uid(), values: isObj(r.values) ? Object.assign({}, r.values) : {},
      createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt), order: Number.isFinite(r.order) ? r.order : k,
      log: (Array.isArray(r.log) ? r.log : []).filter(isObj)});
  }
  function normCard(c, k){
    var out = Object.assign({}, c, {id: str(c.id, '') || uid(), title: str(c.title, 'Sans titre'), icon: str(c.icon, '') || '✅',
      color: HEX.test(c.color) ? c.color : COLORS[0], createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt),
      order: Number.isFinite(c.order) ? c.order : k,
      type: TYPES.indexOf(c.type) >= 0 ? c.type : 'standard',   // anciennes cartes : standard (jamais déduit du titre)
      items: (Array.isArray(c.items) ? c.items : []).filter(isObj).map(normItem),
      goals: (Array.isArray(c.goals) ? c.goals : []).filter(isObj).map(normGoal)});
    if(out.type === 'custom'){
      out.columns = (Array.isArray(c.columns) ? c.columns : []).filter(isObj).map(normCol);
      out.rows = (Array.isArray(c.rows) ? c.rows : []).filter(isObj).map(normRow);
    }
    return out;
  }
  function normalize(chk){
    var src = isObj(chk) ? chk : {};
    var out = Object.assign({}, src, {cards: (Array.isArray(src.cards) ? src.cards : []).filter(isObj).map(normCard)});
    if(isObj(src.defaultCards)) out.defaultCards = Object.assign({}, src.defaultCards);   // drapeaux « cartes par défaut déjà créées » : conservés tels quels
    else delete out.defaultCards;
    return out;
  }
  window.ChkModel = {normalize: normalize};   // fonction pure, réutilisée par la couche Supabase (import, données en ligne)

  /* Nouvelle ligne récurrente : vide, à la date du jour (aucun historique inventé) */
  function newLine(name, rp, kind, target, unit, order){
    var g = withFreq({id: uid(), name: name, repeat: {every: rp.every, unit: rp.unit}, trackingMode: kind === 'check' ? 'check' : 'quantity',
      target: kind === 'check' ? null : target, unit: kind === 'time' ? 'min' : (kind === 'number' ? unit : ''),
      active: true, archivedAt: null, createdAt: now(), updatedAt: now(), order: order,
      since: dkey(new Date()), pauses: [], legacy: [], records: {}, targetLog: []});
    if(kind !== 'check') g.quantityKind = kind;
    return g;
  }
  /* Carte « Devoirs » : checklist paramétrable préconfigurée (les rôles et les identifiants d'options sont stables, les noms restent libres) */
  function newDevoirs(order){
    function col(name, type, role, i, extra){ return Object.assign({id: uid(), name: name, type: type, role: role, order: i, options: []}, extra || {}); }
    return {id: uid(), type: 'custom', preset: 'devoirs', title: 'Devoirs', icon: '📚', color: '#8a4fd1', createdAt: now(), updatedAt: now(), order: order, items: [], goals: [], rows: [],
      columns: [col('Fait', 'checkbox', 'done', 0), col('Matière', 'select', 'subject', 1, {quick: true}), col('Échéance', 'date', 'due', 2), col('Travail', 'text', 'desc', 3),
        col('Type', 'select', 'kind', 4, {quick: true, def: 'travail', options: [{id: 'controle', name: 'Contrôle', color: '#d1457a'}, {id: 'travail', name: 'Travail à faire', color: '#2f6fdb'}]})]};
  }

  /* ---- Moteur des lignes récurrentes ----
     Une « série » = une configuration (répétition + type d'objectif) d'une ligne : les anciennes (legacy), puis l'actuelle. */
  function mkS(g, c, rec, from, to, old){ return {g:g, rp:c.repeat, m:c.trackingMode, kind:kindOf(c), target:c.target, unit:c.unit, rec:rec, from:from, to:to, old:old, tl:c.targetLog || []}; }
  function series(g){
    var out = g.legacy.map(function(l){ return mkS(g, l, l.records, l.from, l.to, true); });
    out.push(mkS(g, g, g.records, g.since, null, false));
    return out;
  }
  function curS(g){ return mkS(g, g, g.records, g.since, null, false); }
  function expected(s, k){   // période attendue = ligne active (ni archivée, ni reconfigurée) au dernier jour de la période
    var e = pend(s, k);
    if(s.to && e >= s.to) return false;
    return !s.g.pauses.some(function(p){ return e >= p.from && (!p.to || e < p.to); });
  }
  function past(s, k, f){   // objectif / unité en vigueur pour la période k : figé dans l'enregistrement, sinon journal des anciens objectifs, sinon actuel
    for(var i = 0; i < s.tl.length; i++) if(k < s.tl[i].until) return s.tl[i][f];
    return s[f];
  }
  function tgt(s, k){ var r = s.rec[k]; return r && ('targetAtTime' in r) ? r.targetAtTime : past(s, k, 'target'); }
  function unitOf(s, k){ var r = s.rec[k]; return r && typeof r.unitAtTime === 'string' ? r.unitAtTime : past(s, k, 'unit'); }
  function res(s, k){   // true atteint · false non atteint · null non évaluable (temps / nombre sans objectif)
    var r = s.rec[k];
    if(s.m === 'quantity'){ var t = tgt(s, k); if(t == null) return null; return !!r && r.value != null && r.value >= t; }
    return !!(r && r.checked);
  }
  function qtxt(s, k, v){ if(s.kind === 'time') return fmtMin(v); var u = unitOf(s, k); return num(v) + (u ? ' ' + u : ''); }
  function ratio(s, k, v){   // « 15 min / 20 min » ou « 25 / 30 répétitions »
    var t = tgt(s, k);
    if(s.kind === 'time') return fmtMin(v) + (t != null ? ' / ' + fmtMin(t) : '');
    var u = unitOf(s, k); return num(v) + (t != null ? ' / ' + num(t) : '') + (u ? ' ' + u : '');
  }
  function cfgLbl(rp, kind){ return repLbl(rp) + ' · ' + KIND[kind]; }
  function objTxt(g){
    var k = kindOf(g);
    if(k === 'check') return 'Case';
    if(k === 'time') return g.target != null ? fmtMin(g.target) : 'Temps libre';
    return g.target != null ? num(g.target) + (g.unit ? ' ' + g.unit : '') : 'Nombre libre' + (g.unit ? ' (' + g.unit + ')' : '');
  }
  function describe(g){ return repLbl(g.repeat) + ' · ' + objTxt(g); }

  /* ---- Valeurs des cartes paramétrables ---- */
  function empty(v){ return v === undefined || v === null || v === ''; }
  function optOf(col, id){ return (col.options || []).filter(function(o){ return o.id === id; })[0] || null; }
  function fits(col, v){   // la valeur est-elle compatible avec le type de la colonne ?
    switch(col.type){
      case 'number': return Number.isFinite(v);
      case 'checkbox': return typeof v === 'boolean';
      case 'date': return typeof v === 'string' && DKEY.test(v);
      case 'select': return typeof v === 'string' && !!optOf(col, v);
      case 'multi': return Array.isArray(v) && v.every(function(x){ return typeof x === 'string'; });
      case 'repeat': return isRep(v);
      case 'priority': return v === 1 || v === 2 || v === 3;
    }
    return typeof v === 'string';
  }
  function rawTxt(v){ var s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > 60 ? s.slice(0, 60) + '…' : s; }
  function toText(v, col){   // valeur lisible
    if(empty(v)) return '';
    if(!fits(col, v)) return typeof v === 'string' ? v : JSON.stringify(v);
    switch(col.type){
      case 'checkbox': return v ? 'Oui' : 'Non';
      case 'select': return optOf(col, v).name;
      case 'multi': return v.map(function(id){ var o = optOf(col, id); return o ? o.name : id; }).join(', ');
      case 'repeat': return repLbl(v);
      case 'priority': return PRIO[v].name;
    }
    return String(v);
  }
  function findOpt(col, name, create){   // option par nom (insensible à la casse) ; créée à la volée si demandé — la clé reste l'identifiant
    name = String(name).trim().slice(0, 40); if(!name) return null;
    var o = col.options.filter(function(x){ return x.name.toLowerCase() === name.toLowerCase(); })[0];
    if(!o && create){ o = {id: uid(), name: name, color: PAL[col.options.length % PAL.length]}; col.options.push(o); }
    return o ? o.id : null;
  }
  function convert(v, from, to){   // changement de type : convertit si possible, sinon renvoie la valeur d'origine (jamais de perte silencieuse)
    if(empty(v) || !fits(from, v)) return v;
    var f = from.type, t = to.type, s = toText(v, from), m, raw = (f === 'select' || f === 'multi') ? s : v;
    if(f === t) return v;
    if(t === 'text' || t === 'longtext') return s;
    if(t === 'link') return raw;
    if(t === 'number'){
      if(f === 'checkbox') return v ? 1 : 0;
      if(f === 'priority') return v;
      m = s.replace(/\s/g, '').replace(',', '.');
      return /^-?\d+(\.\d+)?$/.test(m) ? parseFloat(m) : raw;
    }
    if(t === 'checkbox'){
      if(f === 'number') return v > 0;
      if(/^(oui|vrai|true|1|x|✓|fait)$/i.test(s.trim())) return true;
      if(/^(non|faux|false|0)$/i.test(s.trim())) return false;
      return raw;
    }
    if(t === 'date'){
      if(DKEY.test(s)) return s;
      m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s.trim());
      if(m){ var d = new Date(+m[3], +m[2] - 1, +m[1]); if(d.getMonth() === +m[2] - 1) return dkey(d); }
      return raw;
    }
    if(t === 'select'){
      if(f === 'multi') return v.length === 1 ? v[0] : (v.length ? raw : undefined);
      return findOpt(to, s, true) || raw;
    }
    if(t === 'multi'){
      if(f === 'select') return [v];
      m = s.split(/[,;]/).map(function(x){ return findOpt(to, x, true); }).filter(Boolean);
      return m.length ? m : raw;
    }
    if(t === 'priority'){
      if(f === 'number') return (v === 1 || v === 2 || v === 3) ? v : raw;
      m = s.trim().toLowerCase();
      return has(PRMAP, m) ? PRMAP[m] : raw;
    }
    return raw;   // répétition : aucune conversion possible
  }
  function safeUrl(s){   // seuls les liens http(s) sont cliquables
    try{ var u = new URL(String(s).trim()); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null; }catch(e){ return null; }
  }

window.bootChecklists = function(){
  var KEY = window.CloudSync.keys.chk, $ = function(id){ return document.getElementById(id); };
  var data = normalize(null), cur = null, moved = null, focusLine = null, refocus = null, views = {};

  function el(tag, cls, txt){ var e = document.createElement(tag); if(cls) e.className = cls; if(txt !== undefined) e.textContent = txt; return e; }
  function btn(txt, fn, cls){ var b = el('button', cls || '', txt); b.type = 'button'; b.onclick = fn; return b; }
  function ibtn(icon, label, fn, cls){   // bouton icône : libellé en title (survol), bulle au focus clavier, aria-label
    var b = btn(icon, fn, 'ib' + (cls ? ' ' + cls : '')); b.title = label; b.setAttribute('aria-label', label); b.dataset.lbl = label; return b;
  }
  function each(list, fn){ Array.prototype.forEach.call(list, fn); }
  function today(){ return dkey(new Date()); }
  function maxOrder(list){ return list.reduce(function(m, x){ return Math.max(m, x.order); }, -1) + 1; }
  function findData(root, name, val){ var hit = null; each(root.querySelectorAll('[data-' + name + ']'), function(x){ if(!hit && x.dataset[name] === val && !x.disabled) hit = x; }); return hit; }
  function opt(sel, value, label){ var o = el('option', '', label); o.value = value; sel.appendChild(o); return o; }
  function save(){   // écriture locale ; la synchro Supabase suit (debounce existant)
    try{ localStorage.setItem(KEY, JSON.stringify(data)); }
    catch(e){ $('acctMsg').textContent = 'Attention : enregistrement local impossible (stockage du navigateur plein ?). Exporte tes données sans attendre.'; }
  }
  /* Chargement + migration automatique du cache (écriture silencieuse : aucune synchro n'est déclenchée avant la fin du démarrage) */
  try{
    var rawTxt0 = localStorage.getItem(KEY), parsed = JSON.parse(rawTxt0);
    if(isObj(parsed)){ data = normalize(parsed); if(JSON.stringify(data) !== rawTxt0) save(); }
  }catch(e){}

  function byId(id){ return data.cards.filter(function(c){ return c.id === id; })[0]; }
  function touch(c){ c.updatedAt = now(); }
  function counts(c){ return {d: c.items.filter(function(i){ return i.checked; }).length, n: c.items.length}; }
  function goalProg(c){   // lignes actives : périodes en cours atteintes / évaluables
    var n = 0, d = 0, td = today();
    c.goals.forEach(function(g){
      if(g.archivedAt) return;
      var s = curS(g), r = res(s, pkey(s, td));
      if(r !== null){ n++; if(r) d++; }
    });
    return {d: d, n: n};
  }
  function roles(c){   // colonnes « métier » d'une carte paramétrable, retrouvées par rôle puis par type (jamais par nom)
    var cols = c.columns.slice().sort(byOrder), o = {cols: cols};
    function first(t){ return cols.filter(function(k){ return k.type === t; })[0] || null; }
    function pick(role, t){ return cols.filter(function(k){ return k.role === role && k.type === t; })[0] || null; }
    o.done = pick('done', 'checkbox') || first('checkbox');
    o.due = pick('due', 'date') || first('date');
    o.repeat = first('repeat');
    o.subject = pick('subject', 'select'); o.kind = pick('kind', 'select');
    o.desc = cols.filter(function(k){ return k.role === 'desc'; })[0] || first('text') || first('longtext');
    return o;
  }
  function prog(c){
    if(c.type === 'standard') return counts(c);
    if(c.type !== 'custom') return goalProg(c);
    var d = roles(c).done;
    return {d: d ? c.rows.filter(function(r){ return r.values[d.id] === true; }).length : 0, n: c.rows.length, plain: !d};
  }
  function isDevoirs(c){ return c.type === 'custom' && c.preset === 'devoirs'; }

  /* Saisie d'une durée : heures + minutes (valeur en minutes ; les deux champs vides = aucune valeur) */
  function timeFields(label){
    var wrap = el('span', 'hm'); wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', label);
    function mk(aria){
      var i = el('input'); i.type = 'number'; i.min = '0'; i.step = '1'; i.inputMode = 'numeric';
      i.setAttribute('aria-label', label + ' (' + aria + ')'); return i;
    }
    var h = mk('heures'), m = mk('minutes');
    wrap.appendChild(h); wrap.appendChild(el('span', '', 'h')); wrap.appendChild(m); wrap.appendChild(el('span', '', 'min'));
    return {
      el: wrap,
      read: function(){   // {bad:true} saisie illisible · {empty:true} champs vides · {v: minutes}
        if((h.validity && h.validity.badInput) || (m.validity && m.validity.badInput)) return {bad: true};
        var hs = h.value.trim(), ms = m.value.trim();
        if(hs === '' && ms === '') return {empty: true};
        var hv = hs === '' ? 0 : parseFloat(hs), mv = ms === '' ? 0 : parseFloat(ms);
        if(!(hv >= 0) || !(mv >= 0)) return {bad: true};
        return {v: Math.round(hv * 60 + mv)};
      },
      set: function(v){
        if(v == null){ h.value = ''; m.value = ''; return; }
        v = Math.round(v); h.value = Math.floor(v / 60) || ''; m.value = v % 60;
      }
    };
  }
  /* Champ « Répétition » partagé : « Ne pas répéter / Répéter tous les [X] [jours | semaines | mois | ans] » */
  function repeatField(allowNone){
    var wrap = el('span', 'rep'), mode = el('select'), n = el('input'), u = el('select');
    wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', 'Répétition');
    opt(mode, '0', 'Ne pas répéter'); opt(mode, '1', 'Répéter tous les'); mode.setAttribute('aria-label', 'Répétition');
    n.type = 'number'; n.min = '1'; n.max = '999'; n.step = '1'; n.inputMode = 'numeric'; n.setAttribute('aria-label', 'Intervalle de répétition');
    UNITS.forEach(function(x){ opt(u, x, UL[x][1]); }); u.setAttribute('aria-label', 'Unité de répétition');
    wrap.appendChild(allowNone ? mode : el('span', '', 'Répéter tous les')); wrap.appendChild(n); wrap.appendChild(u);
    function sync(){ var off = allowNone && mode.value === '0'; n.hidden = off; u.hidden = off; }
    mode.onchange = sync;
    return {el: wrap, focus: function(){ (allowNone ? mode : n).focus(); },
      get: function(){
        if(allowNone && mode.value === '0') return null;
        var v = Math.round(parseFloat(n.value));
        return {every: v >= 1 ? Math.min(v, 999) : 1, unit: UNITS.indexOf(u.value) >= 0 ? u.value : 'day'};
      },
      set: function(r){ var ok = isRep(r); mode.value = ok || !allowNone ? '1' : '0'; n.value = ok ? r.every : 1; u.value = ok ? r.unit : 'week'; sync(); }};
  }

  function render(){
    if(cur && !byId(cur)) cur = null;
    $('ckGrid').hidden = !!cur; $('ckDetail').hidden = !cur;
    if(cur) renderDetail(); else renderGrid();
  }

  /* ---- Grille de cartes ---- */
  function renderGrid(){
    var box = $('ckCards'); box.innerHTML = '';
    if(!data.cards.length){ box.appendChild(el('p', 'hint empty', 'Aucune checklist. Crée la première avec « + Nouvelle checklist ».')); return; }
    data.cards.slice().sort(byOrder).forEach(function(c){
      var k = prog(c), card = el('article', 'ck-card');
      card.style.setProperty('--c', c.color);
      var open = el('button', 'ck-open'); open.type = 'button'; open.setAttribute('aria-label', 'Ouvrir la checklist ' + c.title);
      open.appendChild(el('span', 'ck-ico', c.icon)); open.appendChild(el('span', 'ck-title', c.title));
      open.appendChild(el('span', 'ck-count', c.type === 'standard' ? k.d + ' / ' + k.n : c.type === 'custom' ? (k.plain ? k.n + ' ligne(s)' : k.d + ' / ' + k.n + ' fait(s)') : 'En cours : ' + k.d + ' / ' + k.n));
      open.onclick = function(){ cur = c.id; render(); window.scrollTo(0, 0); };
      var pr = el('div', 'ck-prog'), bar = el('i'); bar.style.width = (k.n && !k.plain ? k.d / k.n * 100 : 0) + '%'; pr.appendChild(bar);
      var bt = el('div', 'ck-btns');
      bt.appendChild(ibtn('✏️', 'Modifier « ' + c.title + ' »', function(){ openDlg(c); }));
      bt.appendChild(ibtn('🗑️', 'Supprimer « ' + c.title + ' »', function(){ delCard(c); }));
      card.appendChild(open); card.appendChild(pr); card.appendChild(bt); box.appendChild(card);
    });
    if(!box.firstChild) box.appendChild(el('p', 'hint empty', 'Aucune checklist. Crée la première avec « + Nouvelle checklist ».'));
  }

  /* ---- Petits utilitaires ---- */
  function nextOrder(list){ return list.reduce(function(m, x){ return Math.max(m, +x.order || 0); }, -1) + 1; }
  function qd(root, name, val){ var l = root.querySelectorAll('[data-' + name + ']'), i; for(i = 0; i < l.length; i++) if(l[i].getAttribute('data-' + name) === val) return l[i]; return null; }
  function dd(a, b){ return Math.round((pdate(b) - pdate(a)) / 864e5); }   // nombre de jours de a vers b
  function pEnd(s, k){ return addDays(pnext(s, k), -1); }                  // dernier jour d'une période
  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function nil(v){ return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length); }
  function vis(node, on){ node.hidden = !on; node.style.display = on ? '' : 'none'; }
  function colr(o){ return o && HEX.test(o.color || '') ? o.color : '#8a8f98'; }

  function setRec(s, key, patch){   // crée ou corrige l'enregistrement d'une période (actuelle ou ancienne)
    var r = s.rec[key];
    if(!r){ r = s.rec[key] = {value: null, checked: false}; if(s.m === 'quantity'){ r.targetAtTime = past(s, key, 'target'); r.unitAtTime = past(s, key, 'unit'); } }
    Object.assign(r, patch, {updatedAt: now()});
    if(s.m === 'quantity') r.checked = res(s, key) === true;
    s.g.updatedAt = now();
    data.cards.forEach(function(c){ if(c.goals.indexOf(s.g) >= 0) touch(c); });
    save();
  }
  function delCard(c){   // une carte supprimée n'est jamais recréée : le drapeau defaultCards reste posé
    if(!confirm('Supprimer définitivement la checklist « ' + c.title + ' » et tout son contenu (lignes, objectifs récurrents et historiques) ?')) return;
    data.cards = data.cards.filter(function(x){ return x.id !== c.id; }); save(); render();
  }

  /* ---- Détail d'une carte ---- */
  function detailHead(c){   // en-tête commun : retour, titre, compteur, actions
    var top = el('div', 'head dhead'), counter = el('span', 'date'), acts = el('div', 'acts');
    counter.setAttribute('aria-live', 'polite');
    top.appendChild(ibtn('←', 'Retour aux checklists', function(){ cur = null; render(); }));
    top.appendChild(el('h2', '', c.icon + ' ' + c.title)); top.appendChild(counter); top.appendChild(acts);
    return {el: top, counter: counter, acts: acts};
  }
  function renderDetail(){
    var c = byId(cur), box = $('ckDetail'); box.innerHTML = '';
    if(!c){ cur = null; render(); return; }
    var sec = el('section', 'card ck-card'); sec.style.setProperty('--c', c.color);
    var h = detailHead(c); sec.appendChild(h.el); box.appendChild(sec);
    if(c.type === 'custom') renderCustom(c, sec, h);
    else if(c.type === 'standard') renderStd(c, sec, h);
    else renderGoals(c, sec, h);
  }
  function renderStd(c, sec, h){
    function upd(){ var k = counts(c); h.counter.textContent = k.d + ' / ' + k.n + ' terminées'; }
    function mass(fn){ return function(){ if(fn() === false) return; touch(c); save(); renderDetail(); }; }
    h.acts.appendChild(btn('+ Ligne', function(){ addItem(c); }, 'primary'));
    h.acts.appendChild(ibtn('✏️', 'Modifier la checklist', function(){ openDlg(c); }));
    h.acts.appendChild(ibtn('☑️', 'Tout cocher', mass(function(){ c.items.forEach(function(i){ i.checked = true; i.updatedAt = now(); }); })));
    h.acts.appendChild(ibtn('⬜', 'Tout décocher', mass(function(){ c.items.forEach(function(i){ i.checked = false; i.updatedAt = now(); }); })));
    h.acts.appendChild(ibtn('🧹', 'Supprimer les lignes cochées', mass(function(){
      var n = counts(c).d; if(!n || !confirm('Supprimer les ' + n + ' élément(s) coché(s) ?')) return false;
      c.items = c.items.filter(function(i){ return !i.checked; });
    })));
    var list = el('div'); list.id = 'ckList';
    c.items.slice().sort(byOrder).forEach(function(it){ list.appendChild(row(c, it, upd)); });
    if(!c.items.length) list.appendChild(el('p', 'hint empty', 'Aucune ligne. Ajoute la première avec « + Ligne ».'));
    sec.appendChild(list);
    if(c.goals.length) sec.appendChild(el('p', 'hint', c.goals.length + ' objectif(s) récurrent(s) conservé(s) avec leur historique : masqués tant que le type de la carte est « Standard ».'));
    upd();
  }
  function row(c, it, upd){
    var r = el('div', 'ck-item' + (it.checked ? ' done' : ''));
    var cb = el('input'); cb.type = 'checkbox'; cb.checked = it.checked; cb.setAttribute('aria-label', 'Terminé');
    cb.onchange = function(){ it.checked = cb.checked; it.updatedAt = now(); touch(c); r.classList.toggle('done', cb.checked); upd(); save(); };
    var tx = el('input'); tx.type = 'text'; tx.value = it.text; tx.maxLength = 300; tx.setAttribute('aria-label', 'Texte de la ligne');
    tx.oninput = function(){ it.text = tx.value; it.updatedAt = now(); touch(c); save(); };
    tx.onkeydown = function(e){ if(e.key === 'Enter'){ e.preventDefault(); if(c.type === 'standard') addItem(c); } };
    var del = ibtn('🗑️', 'Supprimer la ligne', function(){
      if(it.text.trim() && !confirm('Supprimer cette ligne ?')) return;   // une ligne vide se supprime sans confirmation
      c.items = c.items.filter(function(x){ return x.id !== it.id; }); touch(c); save(); renderDetail();
    });
    r.appendChild(cb); r.appendChild(tx); r.appendChild(del);
    return r;
  }
  function addItem(c){
    c.items.push({id: uid(), text: '', checked: false, createdAt: now(), updatedAt: now(), order: nextOrder(c.items)});
    touch(c); save(); renderDetail();
    var last = document.querySelector('#ckList .ck-item:last-child input[type=text]'); if(last) last.focus();
  }

  /* ---- Boîte de création / modification d'une carte (+ éditeur de colonnes des cartes paramétrables) ---- */
  var dlg = $('ckDialog'), editing = null, sel = {icon: EMOJIS[0], color: COLORS[0]}, edCols = [];
  var colorPick = document.createElement('input'); colorPick.type = 'color'; colorPick.setAttribute('aria-label', 'Autre couleur');
  function mark(){
    Array.prototype.forEach.call($('ckdEmojis').children, function(b){ b.classList.toggle('on', b.textContent === sel.icon); });
    Array.prototype.forEach.call($('ckdColors').querySelectorAll('button'), function(b, i){ b.classList.toggle('on', COLORS[i] === sel.color); });
  }
  EMOJIS.forEach(function(e){
    var b = btn(e, function(){ sel.icon = e; $('ckdEmoji').value = ''; mark(); }); b.setAttribute('aria-label', 'Icône ' + e);
    $('ckdEmojis').appendChild(b);
  });
  COLORS.forEach(function(col){
    var b = btn('', function(){ sel.color = col; colorPick.value = col; mark(); }); b.style.setProperty('--c', col); b.setAttribute('aria-label', 'Couleur ' + col);
    $('ckdColors').appendChild(b);
  });
  colorPick.oninput = function(){ sel.color = colorPick.value; mark(); }; $('ckdColors').appendChild(colorPick);
  $('ckdEmoji').oninput = function(){ if(this.value.trim()) sel.icon = this.value.trim(); mark(); };
  function defCols(){   // colonnes proposées pour une nouvelle carte paramétrable
    return [{id: uid(), name: 'Fait', type: 'checkbox', options: [], order: 0}, {id: uid(), name: 'Titre', type: 'text', options: [], order: 1}, {id: uid(), name: 'Date', type: 'date', options: [], order: 2}];
  }
  function drawCols(fi, fsel){
    var host = $('ckdCols'); host.innerHTML = '';
    host.appendChild(el('span', '', 'Colonnes du tableau'));
    function swap(i, d){ var j = i + d, t; if(j < 0 || j >= edCols.length) return; t = edCols[i]; edCols[i] = edCols[j]; edCols[j] = t; drawCols(j, '[data-d="' + d + '"]'); }
    edCols.forEach(function(col, i){
      var rw = el('div', 'ce-row'), top = el('div', 'ce-top'), nm = el('input'), ty = el('select'), n = i + 1;
      if(!Array.isArray(col.options)) col.options = [];
      nm.type = 'text'; nm.maxLength = 60; nm.value = col.name || ''; nm.placeholder = 'Nom de la colonne'; nm.setAttribute('aria-label', 'Nom de la colonne ' + n);
      nm.oninput = function(){ col.name = nm.value; };
      ty.setAttribute('aria-label', 'Type de la colonne ' + n);
      Object.keys(COLT).forEach(function(t){ opt(ty, t, COLT[t]); }); ty.value = col.type;
      if(col.role){ ty.disabled = true; ty.title = 'Colonne utilisée par le suivi des devoirs : type fixe'; }
      ty.onchange = function(){ col.type = ty.value; drawCols(i, 'select'); };
      var up = ibtn('↑', 'Monter la colonne ' + n, function(){ swap(i, -1); }), dn = ibtn('↓', 'Descendre la colonne ' + n, function(){ swap(i, 1); });
      up.disabled = i === 0; dn.disabled = i === edCols.length - 1; up.setAttribute('data-d', '-1'); dn.setAttribute('data-d', '1');
      top.appendChild(nm); top.appendChild(ty); top.appendChild(up); top.appendChild(dn);
      if(!col.role) top.appendChild(ibtn('🗑️', 'Supprimer la colonne ' + n, function(){
        if(!confirm('Supprimer la colonne « ' + (col.name || 'sans nom') + ' » ? Ses valeurs seront supprimées à l’enregistrement.')) return;
        edCols.splice(i, 1); drawCols(Math.min(i, edCols.length - 1), 'input');
      }));
      rw.appendChild(top);
      if(col.type === 'number'){
        var ul = el('label', 'ce-opt'), ui = el('input');
        ui.type = 'text'; ui.maxLength = 20; ui.value = col.unit || ''; ui.placeholder = 'km, pages…'; ui.oninput = function(){ col.unit = ui.value.trim(); };
        ul.appendChild(el('span', '', 'Unité')); ul.appendChild(ui); rw.appendChild(ul);
      }
      if(col.type === 'select' || col.type === 'multi'){
        var ob = el('div', 'ce-opts');
        col.options.forEach(function(o, j){
          var ow = el('span', 'ce-opt'), oc = el('input'), on = el('input');
          oc.type = 'color'; oc.value = HEX.test(o.color || '') ? o.color : PAL[j % PAL.length]; oc.setAttribute('aria-label', 'Couleur de l’option ' + (j + 1));
          o.color = oc.value; oc.oninput = function(){ o.color = oc.value; };
          on.type = 'text'; on.maxLength = 40; on.value = o.name || ''; on.placeholder = 'Option'; on.setAttribute('aria-label', 'Nom de l’option ' + (j + 1));
          on.oninput = function(){ o.name = on.value; };
          ow.appendChild(oc); ow.appendChild(on);
          ow.appendChild(ibtn('✕', 'Supprimer l’option ' + (j + 1), function(){ col.options.splice(j, 1); drawCols(i, '.ce-opts button'); }));
          ob.appendChild(ow);
        });
        ob.appendChild(btn('+ Option', function(){ col.options.push({id: uid(), name: '', color: PAL[col.options.length % PAL.length]}); drawCols(i, '.ce-opt:last-of-type input[type=text]'); }, 'ce-add'));
        rw.appendChild(ob);
      }
      host.appendChild(rw);
    });
    host.appendChild(btn('+ Colonne', function(){ edCols.push({id: uid(), name: '', type: 'text', options: [], order: edCols.length}); drawCols(edCols.length - 1, 'input'); }, 'ce-add'));
    if(fi != null && fi >= 0){
      var r = host.querySelectorAll('.ce-row')[fi], f = r && r.querySelector(fsel || 'input');
      if(r && (!f || f.disabled)) f = r.querySelector('button:not([disabled])');
      if(f) f.focus();
    }
  }
  function applyCols(c){   // enregistre l'éditeur : conversion si le type change (valeur brute gardée si non convertible), options et colonnes supprimées
    var old = dict(), keep = dict();
    (c.columns || []).forEach(function(k){ old[k.id] = k; });
    if(!Array.isArray(c.rows)) c.rows = [];
    edCols.forEach(function(k, i){
      var o = old[k.id], gone = dict(), any = false;
      k.order = i; keep[k.id] = 1; if(!Array.isArray(k.options)) k.options = [];
      if(!o) return;
      if(o.type === k.type && (k.type === 'select' || k.type === 'multi')) (o.options || []).forEach(function(x){
        if(!k.options.some(function(y){ return y.id === x.id; })){ gone[x.id] = 1; any = true; }
      });
      if(o.type === k.type && !any) return;
      c.rows.forEach(function(r){
        if(!isObj(r.values) || !has(r.values, k.id)) return;
        var x = r.values[k.id];
        if(o.type !== k.type) r.values[k.id] = convert(x, o, k);
        else if(typeof x === 'string' && gone[x]) delete r.values[k.id];
        else if(Array.isArray(x)) r.values[k.id] = x.filter(function(y){ return !gone[y]; });
        r.updatedAt = now();
      });
    });
    c.rows.forEach(function(r){ if(isObj(r.values)) Object.keys(r.values).forEach(function(id){ if(old[id] && !keep[id]) delete r.values[id]; }); });
    c.columns = edCols;
  }
  function syncCols(){
    var on = editing ? editing.type === 'custom' : $('ckdType').value === 'custom';
    vis($('ckdCols'), on); if(on) drawCols();
  }
  $('ckdType').onchange = syncCols;
  function openDlg(c){
    editing = c || null;
    $('ckdTitle').textContent = c ? 'Modifier la checklist' : 'Nouvelle checklist';
    $('ckdName').value = c ? c.title : ''; $('ckdType').value = c && c.type === 'custom' ? 'custom' : 'standard';
    vis($('ckdTypeBox'), !c);   // le type d'une carte existante ne change pas
    edCols = c && c.type === 'custom' ? clone(c.columns || []).sort(byOrder) : defCols();
    sel.icon = c ? c.icon : EMOJIS[0]; sel.color = c ? c.color : COLORS[0];
    $('ckdEmoji').value = EMOJIS.indexOf(sel.icon) < 0 ? sel.icon : ''; colorPick.value = sel.color; $('ckdErr').textContent = '';
    syncCols(); mark(); dlg.showModal(); $('ckdName').focus();
  }
  $('ckForm').onsubmit = function(e){
    e.preventDefault();
    var name = $('ckdName').value.trim(), err = $('ckdErr');
    if(!name){ err.textContent = 'Donne un nom à la checklist.'; return; }
    var type = editing ? editing.type : ($('ckdType').value === 'custom' ? 'custom' : 'standard');
    if(type === 'custom'){
      if(!edCols.length){ err.textContent = 'Ajoute au moins une colonne.'; return; }
      if(edCols.some(function(k){ return !String(k.name || '').trim(); })){ err.textContent = 'Donne un nom à chaque colonne.'; return; }
      edCols.forEach(function(k, i){
        k.name = String(k.name).trim(); k.order = i;
        (k.options || []).forEach(function(o, j){ o.name = String(o.name || '').trim() || 'Option ' + (j + 1); });
      });
    }
    if(editing){ editing.title = name; editing.icon = sel.icon; editing.color = sel.color; if(type === 'custom') applyCols(editing); touch(editing); }
    else{
      var card = {id: uid(), type: type, title: name, icon: sel.icon, color: sel.color, createdAt: now(), updatedAt: now(), order: nextOrder(data.cards), items: [], goals: []};
      if(type === 'custom'){ card.columns = edCols; card.rows = []; }
      data.cards.push(card);
    }
    save(); dlg.close(); render();
  };
  $('ckdCancel').onclick = function(){ dlg.close(); };
  $('ckNew').onclick = function(){ openDlg(null); };

  /* ---- Petit dialogue « Répétition » (cellules des cartes paramétrables) ---- */
  var rpDlg = $('rpDialog'), rpF = repeatField(true), rpDone = null;
  $('rpHost').appendChild(rpF.el);
  $('rpForm').onsubmit = function(e){ e.preventDefault(); var f = rpDone; rpDone = null; rpDlg.close(); if(f) f(rpF.get()); };
  $('rpCancel').onclick = function(){ rpDone = null; rpDlg.close(); };
  function askRep(title, r, fn){ $('rpTitle').textContent = title; rpF.set(isRep(r) ? r : null); rpDone = fn; rpDlg.showModal(); rpF.focus(); }

  /* ---- Cartes paramétrables : tableau à colonnes libres ---- */
  function sortVal(col, x){
    if(col.type === 'checkbox') return x === true ? 1 : 0;
    if(nil(x)) return null;
    if(!fits(col, x)) return String(rawTxt(x)).toLowerCase();
    if(col.type === 'number' || col.type === 'priority') return +x;
    if(col.type === 'date') return x;
    if(col.type === 'repeat') return x.every * ({day: 1, week: 7, month: 30, year: 365}[x.unit] || 1);
    return String(toText(x, col)).toLowerCase();
  }
  function matchF(col, x, f, td){
    if(nil(f)) return true;
    switch(col.type){
      case 'checkbox': return (x === true) === (f === '1');
      case 'select': case 'priority': return f === '-' ? nil(x) : String(x) === f;
      case 'multi': return f === '-' ? nil(x) : Array.isArray(x) && x.indexOf(f) >= 0;
      case 'repeat': return !!isRep(x) === (f === '1');
      case 'date':
        if(f === '-') return nil(x);
        if(!DKEY.test(x || '')) return false;
        return f === 'late' ? x < td : (f === 'today' ? x === td : (f === 'week' ? x >= td && x <= addDays(td, 7) : x >= td));
      default: return String(nil(x) ? '' : (fits(col, x) ? toText(x, col) : rawTxt(x))).toLowerCase().indexOf(String(f).toLowerCase()) >= 0;
    }
  }
  function duePill(k, done){   // pastille d'échéance : en retard / aujourd'hui / demain / dans X j
    if(done || !DKEY.test(k || '')) return null;
    var n = dd(today(), k);
    return el('span', 'pill' + (n < 0 ? ' late' : (n <= 1 ? ' soon' : '')), n < 0 ? 'en retard' : (n === 0 ? 'aujourd’hui' : (n === 1 ? 'demain' : 'dans ' + n + ' j')));
  }
  function renderCustom(c, sec, h){
    if(!Array.isArray(c.rows)) c.rows = [];
    var R = roles(c), cols = R.cols || (c.columns || []).slice().sort(byOrder), td = today();
    var v = views[c.id] || (views[c.id] = {sort: isDevoirs(c) && R.due ? R.due.id : null, dir: 1, f: {}, q: {}, done: isDevoirs(c) && R.done ? 'todo' : 'all', showF: false});
    var live = el('p', 'hint'), quick = el('div', 'quick'), wrap = el('div', 'tablewrap'), table = el('table', 'ct'), thead = el('thead'), tbody = el('tbody'), note = el('div');
    live.setAttribute('aria-live', 'polite'); vis(live, false);
    function isDone(r){ return R.done ? r.values[R.done.id] === true : false; }
    function setVal(r, col, x){ if(nil(x)) delete r.values[col.id]; else r.values[col.id] = x; r.updatedAt = now(); touch(c); save(); }
    function tagIt(node, r, col){ node.setAttribute('data-r', r.id); node.setAttribute('data-c', col.id); node.setAttribute('aria-label', col.name); return node; }
    function toggleDone(r, on){
      var due = R.due ? r.values[R.due.id] : null, rp = R.repeat ? r.values[R.repeat.id] : null, okDue = DKEY.test(due || ''), base;
      live.textContent = ''; vis(live, false);
      if(on && R.due && isRep(rp)){   // ligne répétée : trace dans le journal, échéance décalée, case décochée
        base = okDue ? due : today();
        if(typeof r.anchorDay !== 'number') r.anchorDay = +base.slice(8, 10);
        if(!Array.isArray(r.log)) r.log = [];
        r.log.push({at: now(), day: today(), due: okDue ? due : null});
        r.values[R.due.id] = nextOcc(base, rp, r.anchorDay);
        r.values[R.done.id] = false; delete r.doneAt;
        live.textContent = 'Ligne réarmée : prochaine échéance le ' + dfmt(r.values[R.due.id]) + '.'; vis(live, true);
      }else{
        r.values[R.done.id] = on;
        if(on) r.doneAt = today(); else delete r.doneAt;
      }
      r.updatedAt = now(); touch(c); save(); redraw(r.id, R.done.id);
    }
    function pick(col, done){   // « + Nouvelle… » : option ajoutée à la volée
      var name = (prompt('Nom de la nouvelle option pour « ' + col.name + ' » :') || '').trim().slice(0, 40), o = name ? findOpt(col, name, true) : null;
      if(o && o.id){ touch(c); done(o.id); } else done(null);
    }
    function fill(cell, r, col, force){
      var x = r.values[col.id], t = col.type, inp;
      cell.innerHTML = '';
      if(!force && !nil(x) && !fits(col, x)){   // valeur d'origine non convertible : affichée telle quelle, remplaçable
        inp = tagIt(btn(String(rawTxt(x)), function(){ fill(cell, r, col, true); var f = cell.querySelector('[data-r]'); if(f) f.focus(); }, 'rawv'), r, col);
        inp.title = 'Valeur d’origine conservée (incompatible avec le type « ' + COLT[t] + ' »). Activer pour la remplacer.';
        inp.setAttribute('aria-label', col.name + ' : valeur d’origine ' + rawTxt(x) + ' — remplacer');
        cell.appendChild(inp); return;
      }
      if(force) x = undefined;
      if(t === 'checkbox'){
        inp = el('input'); inp.type = 'checkbox'; inp.checked = x === true;
        inp.onchange = function(){
          if(R.done && col.id === R.done.id) toggleDone(r, inp.checked);
          else{ r.values[col.id] = inp.checked; r.updatedAt = now(); touch(c); save(); }
        };
      }else if(t === 'longtext'){
        inp = el('textarea'); inp.rows = 1; inp.maxLength = 2000; inp.value = nil(x) ? '' : x; inp.oninput = function(){ setVal(r, col, inp.value); };
      }else if(t === 'number'){
        inp = el('input'); inp.type = 'number'; inp.step = 'any'; inp.inputMode = 'decimal'; inp.value = nil(x) ? '' : x;
        inp.oninput = function(){
          var n = parseFloat(inp.value);
          if(inp.value === ''){ if(!(inp.validity && inp.validity.badInput)) setVal(r, col, null); }
          else if(isFinite(n)) setVal(r, col, n);
        };
      }else if(t === 'date'){
        inp = el('input'); inp.type = 'date'; inp.value = nil(x) ? '' : x;
        inp.onchange = function(){
          var okD = DKEY.test(inp.value);
          if(R.due && col.id === R.due.id){ if(okD) r.anchorDay = +inp.value.slice(8, 10); else delete r.anchorDay; }
          setVal(r, col, okD ? inp.value : null); redraw(r.id, col.id);
        };
      }else if(t === 'select' || t === 'priority'){
        inp = el('select'); opt(inp, '', '—');
        if(t === 'priority') Object.keys(PRIO).forEach(function(k){ opt(inp, k, PRIO[k].name); });
        else{ (col.options || []).forEach(function(o){ opt(inp, o.id, o.name); }); opt(inp, '+', '+ Nouvelle…'); }
        inp.value = nil(x) ? '' : String(x);
        var oc = nil(x) ? null : (t === 'priority' ? PRIO[x] : optOf(col, x));
        if(oc && oc.color) inp.style.borderLeft = '4px solid ' + oc.color;
        inp.onchange = function(){
          if(inp.value === '+'){ pick(col, function(id){ if(id) setVal(r, col, id); redraw(r.id, col.id); }); return; }
          setVal(r, col, t === 'priority' && inp.value ? +inp.value : inp.value); redraw(r.id, col.id);
        };
      }else if(t === 'multi'){
        var box = el('span', 'tags'), arr = Array.isArray(x) ? x : [];
        arr.forEach(function(id){
          var o = optOf(col, id), chip, xb; if(!o) return;
          chip = el('span', 'tagc', o.name); chip.style.setProperty('--c', colr(o));
          xb = btn('×', function(){ setVal(r, col, arr.filter(function(y){ return y !== id; })); redraw(r.id, col.id); }, 'tagx');
          xb.setAttribute('aria-label', 'Retirer ' + o.name); xb.title = 'Retirer';
          chip.appendChild(xb); box.appendChild(chip);
        });
        inp = el('select', 'tag-add'); opt(inp, '', '+');
        (col.options || []).forEach(function(o){ if(arr.indexOf(o.id) < 0) opt(inp, o.id, o.name); }); opt(inp, '+', '+ Nouvelle…');
        inp.onchange = function(){
          var add = function(id){ if(id && arr.indexOf(id) < 0) setVal(r, col, arr.concat([id])); redraw(r.id, col.id); };
          if(inp.value === '+') pick(col, add); else add(inp.value);
        };
        tagIt(inp, r, col); inp.setAttribute('aria-label', col.name + ' : ajouter une étiquette'); box.appendChild(inp); cell.appendChild(box); return;
      }else if(t === 'repeat'){
        inp = btn(isRep(x) ? '🔁 ' + repShort(x) : '—', function(){ askRep(col.name, x, function(nv){ setVal(r, col, nv); redraw(r.id, col.id); }); }, 'pillbtn');
        tagIt(inp, r, col); inp.title = isRep(x) ? repLbl(x) : 'Ne pas répéter';
        inp.setAttribute('aria-label', col.name + ' : ' + (isRep(x) ? repLbl(x) : 'aucune') + ' — modifier'); cell.appendChild(inp); return;
      }else if(t === 'link'){
        inp = el('input'); inp.type = 'url'; inp.maxLength = 500; inp.value = nil(x) ? '' : x; inp.placeholder = 'https://…';
        var a = el('a', 'ib', '🔗'); a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = 'Ouvrir le lien'; a.setAttribute('aria-label', 'Ouvrir le lien — ' + col.name);
        var syncA = function(){   // seuls les liens http(s) sont cliquables
          var u = safeUrl(inp.value.trim());
          if(u){ a.href = typeof u === 'string' ? u : inp.value.trim(); if(!a.parentNode) cell.appendChild(a); }
          else if(a.parentNode) cell.removeChild(a);
        };
        inp.oninput = function(){ setVal(r, col, inp.value.trim()); syncA(); };
        cell.appendChild(tagIt(inp, r, col)); syncA(); return;
      }else{
        inp = el('input'); inp.type = 'text'; inp.maxLength = 300; inp.value = nil(x) ? '' : x; inp.oninput = function(){ setVal(r, col, inp.value); };
      }
      cell.appendChild(tagIt(inp, r, col));
      if(t === 'number' && col.unit) cell.appendChild(el('span', 'unit', col.unit));
      if(t === 'date' && R.due && col.id === R.due.id){ var p = duePill(x, isDone(r)); if(p) cell.appendChild(p); }
    }
    function rowEl(r){
      var tr = el('tr', isDone(r) ? 'done' : ''), a = el('td', 'act');
      if(!isObj(r.values)) r.values = {};
      cols.forEach(function(col){ var cell = el('td'); fill(cell, r, col); tr.appendChild(cell); });
      a.appendChild(ibtn('🗑️', 'Supprimer la ligne', function(){
        if(Object.keys(r.values).some(function(k){ return !nil(r.values[k]) && r.values[k] !== false; }) && !confirm('Supprimer cette ligne ?')) return;
        c.rows = c.rows.filter(function(x){ return x.id !== r.id; }); touch(c); save(); redraw(null);
      }));
      tr.appendChild(a); return tr;
    }
    function visible(){
      var sc = v.sort ? cols.filter(function(k){ return k.id === v.sort; })[0] : null;
      return c.rows.filter(function(r){
        var d = isDone(r);
        if(!isObj(r.values)) r.values = {};
        if(R.done && ((v.done === 'todo' && d) || (v.done === 'done' && !d))) return false;
        return cols.every(function(col){
          var x = r.values[col.id];
          if(v.q[col.id] && x !== v.q[col.id]) return false;
          return matchF(col, x, v.f[col.id], td);
        });
      }).sort(function(a, b){
        var x, y, d;
        if(sc){
          x = sortVal(sc, a.values[sc.id]); y = sortVal(sc, b.values[sc.id]);
          if(x === null || y === null){ if(x !== y) return x === null ? 1 : -1; }   // cellules vides toujours en dernier
          else{ d = (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr', {numeric: true})) * v.dir; if(d) return d; }
        }
        return byOrder(a, b);
      });
    }
    function chip(txt, on, fn, key, color){
      var b = btn(txt, fn, 'fchip' + (color ? ' dot' : '') + (on ? ' on' : ''));
      b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.setAttribute('data-r', 'q'); b.setAttribute('data-c', key);
      if(color) b.style.setProperty('--c', color);
      return b;
    }
    function drawQuick(){
      quick.innerHTML = '';
      if(R.done){
        var g = el('div', 'qgrp'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', 'Filtre par état');
        g.appendChild(el('span', 'qlbl', 'État'));
        [['all', 'Tout'], ['todo', 'À faire'], ['done', 'Faits']].forEach(function(o){
          g.appendChild(chip(o[1], v.done === o[0], function(){ v.done = o[0]; redraw('q', 'done|' + o[0]); }, 'done|' + o[0]));
        });
        quick.appendChild(g);
      }
      cols.forEach(function(col){
        if(!col.quick || col.type !== 'select') return;
        var g = el('div', 'qgrp'), cq = v.q[col.id] || '';
        g.setAttribute('role', 'group'); g.setAttribute('aria-label', 'Filtre ' + col.name);
        g.appendChild(el('span', 'qlbl', col.name));
        g.appendChild(chip('Tout', !cq, function(){ delete v.q[col.id]; redraw('q', col.id + '|'); }, col.id + '|'));
        (col.options || []).forEach(function(o){
          g.appendChild(chip(o.name, cq === o.id, function(){ if(cq === o.id) delete v.q[col.id]; else v.q[col.id] = o.id; redraw('q', col.id + '|' + o.id); }, col.id + '|' + o.id, colr(o)));
        });
        quick.appendChild(g);
      });
      vis(quick, !!quick.firstChild);
    }
    function filterCtl(col){
      var t = col.type, f, cv = v.f[col.id] || '';
      function setF(val){ if(val) v.f[col.id] = val; else delete v.f[col.id]; drawRows(); }
      function list(o){ f = el('select'); opt(f, '', 'Tout'); o.forEach(function(x){ opt(f, x[0], x[1]); }); f.value = cv; f.onchange = function(){ setF(f.value); }; }
      if(t === 'checkbox' || t === 'repeat') list([['1', 'Oui'], ['0', 'Non']]);
      else if(t === 'date') list([['late', 'En retard'], ['today', 'Aujourd’hui'], ['week', '7 prochains jours'], ['next', 'À venir'], ['-', 'Sans date']]);
      else if(t === 'select' || t === 'multi') list((col.options || []).map(function(x){ return [x.id, x.name]; }).concat([['-', 'Vide']]));
      else if(t === 'priority') list(Object.keys(PRIO).map(function(k){ return [k, PRIO[k].name]; }).concat([['-', 'Vide']]));
      else{ f = el('input'); f.type = 'search'; f.value = cv; f.placeholder = 'Filtrer'; f.oninput = function(){ setF(f.value); }; }
      f.setAttribute('aria-label', 'Filtrer ' + col.name);
      return f;
    }
    function drawHead(){
      thead.innerHTML = '';
      var tr = el('tr'), fl = el('tr', 'flt'), last = el('th'), x = el('td');
      cols.forEach(function(col){
        var th = el('th'), on = v.sort === col.id, ftd = el('td');
        var b = btn(col.name + (on ? (v.dir > 0 ? ' ▲' : ' ▼') : ''), function(){
          if(!on){ v.sort = col.id; v.dir = 1; } else if(v.dir > 0) v.dir = -1; else v.sort = null;
          redraw('h', col.id);
        }, 'th-sort');
        th.scope = 'col'; th.setAttribute('aria-sort', on ? (v.dir > 0 ? 'ascending' : 'descending') : 'none');
        b.title = 'Trier par ' + col.name; b.setAttribute('data-r', 'h'); b.setAttribute('data-c', col.id);
        th.appendChild(b); tr.appendChild(th);
        ftd.appendChild(filterCtl(col)); fl.appendChild(ftd);
      });
      last.appendChild(el('span', 'sr', 'Actions')); tr.appendChild(last); thead.appendChild(tr);
      if(v.showF){ x.appendChild(ibtn('✕', 'Effacer les filtres de colonne', function(){ v.f = {}; redraw(null); })); fl.appendChild(x); thead.appendChild(fl); }
    }
    function drawRows(){
      var rows = visible(), nd = 0, p;
      tbody.innerHTML = ''; note.innerHTML = '';
      rows.forEach(function(r){ tbody.appendChild(rowEl(r)); });
      c.rows.forEach(function(r){ if(isDone(r)) nd++; });
      h.counter.textContent = R.done ? nd + ' / ' + c.rows.length + ' faits' : c.rows.length + ' ligne' + (c.rows.length > 1 ? 's' : '');
      vis(wrap, cols.length > 0 && (rows.length > 0 || v.showF));
      if(!cols.length) note.appendChild(el('p', 'hint empty', 'Aucune colonne. Ajoute-en avec ✏️ « Modifier la carte et ses colonnes ».'));
      else if(!c.rows.length) note.appendChild(el('p', 'hint empty', 'Aucune ligne. Ajoute la première avec « + Ligne ».'));
      else if(!rows.length){
        p = el('p', 'hint empty', 'Aucune ligne ne correspond aux filtres. ');
        p.appendChild(btn('Tout afficher', function(){ v.f = {}; v.q = {}; v.done = 'all'; redraw(null); }));
        note.appendChild(p);
      }
    }
    function redraw(fr, fc){   // redessine en rendant le focus à la même cellule
      var a = document.activeElement, l, i;
      if(fr === undefined && a && a.getAttribute && sec.contains(a)){ fr = a.getAttribute('data-r'); fc = a.getAttribute('data-c'); }
      drawQuick(); drawHead(); drawRows();
      if(!fr) return;
      l = sec.querySelectorAll('[data-r]');
      for(i = 0; i < l.length; i++) if(l[i].getAttribute('data-r') === fr && (fc == null || l[i].getAttribute('data-c') === fc)){ l[i].focus(); return; }
    }
    function addRow(){
      var r = {id: uid(), values: {}, log: [], createdAt: now(), updatedAt: now(), order: nextOrder(c.rows)}, l, i;
      cols.forEach(function(col){
        if(col.type === 'checkbox') r.values[col.id] = false;
        else if(v.q[col.id]) r.values[col.id] = v.q[col.id];
        else if(!nil(col.def)) r.values[col.id] = col.def;
      });
      v.f = {}; if(v.done === 'done') v.done = 'all';
      c.rows.push(r); touch(c); save(); redraw(null);
      l = tbody.querySelectorAll('[data-r]');
      for(i = 0; i < l.length; i++) if(l[i].getAttribute('data-r') === r.id && l[i].type !== 'checkbox'){ l[i].focus(); break; }
    }
    var addB = btn('+ Ligne', addRow, 'primary'); addB.disabled = !cols.length; h.acts.appendChild(addB);
    var fb = ibtn('🔎', 'Filtres par colonne', function(){ v.showF = !v.showF; fb.setAttribute('aria-pressed', v.showF ? 'true' : 'false'); redraw(null); fb.focus(); });
    fb.setAttribute('aria-pressed', v.showF ? 'true' : 'false'); h.acts.appendChild(fb);
    h.acts.appendChild(ibtn('✏️', 'Modifier la carte et ses colonnes', function(){ openDlg(c); }));
    table.appendChild(thead); table.appendChild(tbody); wrap.appendChild(table);
    sec.appendChild(quick); sec.appendChild(live); sec.appendChild(wrap); sec.appendChild(note);
    redraw(null);
  }

  /* ---- Cartes Sport / Ménage : lignes récurrentes sur une rangée ---- */
  function ctl(s, key, title, aria, upd, off){   // saisie d'une période : case, temps réalisé ou nombre réalisé (+ objectif de l'époque)
    var rw = el('div', 'g-row'), st = el('span', 'g-st'), r0 = s.rec[key], auto = null;
    var isCur = !s.old && !s.g.archivedAt && key === pkey(s, today());
    st.setAttribute('aria-live', 'polite');
    function status(msg){   // l'état est toujours écrit en toutes lettres (pas seulement une couleur)
      var x = res(s, key), txt;
      if(s.m === 'quantity'){
        auto.classList.toggle('on', x === true); auto.classList.toggle('na', x === null);
        auto.setAttribute('aria-label', x === null ? 'Sans objectif : valeur seulement totalisée' : (x ? 'Objectif atteint' : 'Objectif non atteint'));
        txt = x === null ? '' : (x ? 'atteint' : (isCur ? 'en cours' : 'non atteint'));
      }else txt = x ? 'fait' : (isCur ? 'à faire' : 'non fait');
      st.textContent = msg || (txt + (off ? ' · hors activité' : ''));
      st.classList.toggle('g-err', !!msg);
    }
    function refresh(){ status(); if(upd) upd(); }
    if(s.m === 'quantity'){
      var val = el('span', 'g-val'), t = tgt(s, key), u = unitOf(s, key);
      auto = el('span', 'ck-auto', '✓'); auto.setAttribute('role', 'img');
      rw.appendChild(auto); rw.appendChild(el('span', 'g-title', title));
      if(s.kind === 'time'){
        var tf = timeFields(aria + ' : temps réalisé');
        tf.set(r0 && r0.value != null ? r0.value : null);
        tf.el.addEventListener('input', function(){
          var x = tf.read();
          if(x.bad){ status('Valeur refusée : nombres ≥ 0 uniquement.'); return; }
          if(x.empty){ if(!s.rec[key]) return; setRec(s, key, {value: null}); }   // champs vidés : saisie retirée
          else setRec(s, key, {value: x.v});
          refresh();
        });
        val.appendChild(tf.el);
      }else{
        var inp = el('input');
        inp.type = 'number'; inp.min = '0'; inp.step = 'any'; inp.inputMode = 'decimal';
        inp.value = r0 && r0.value != null ? r0.value : '';
        inp.setAttribute('aria-label', aria + ' : réalisé' + (u ? ' (' + u + ')' : ''));
        inp.oninput = function(){
          var x = parseFloat(inp.value);
          if(inp.value === ''){ if((inp.validity && inp.validity.badInput) || !s.rec[key]) return; setRec(s, key, {value: null}); }
          else if(x >= 0) setRec(s, key, {value: x});
          else { status('Valeur refusée : nombre ≥ 0 uniquement.'); return; }
          refresh();
        };
        val.appendChild(inp);
      }
      val.appendChild(el('span', 'unit', t != null ? '/ ' + qtxt(s, key, t) : (s.kind === 'time' ? '' : (u || ''))));
      rw.appendChild(val);
    }else{
      var cb = el('input'), lab = el('label', 'g-title', title);
      cb.type = 'checkbox'; cb.id = 'g' + uid(); lab.htmlFor = cb.id; cb.checked = !!(r0 && r0.checked);
      cb.setAttribute('aria-label', aria);
      cb.onchange = function(){ setRec(s, key, {checked: cb.checked}); refresh(); };
      rw.appendChild(cb); rw.appendChild(lab);
    }
    rw.appendChild(st); status(); return rw;
  }
  function histPanel(g){   // historique corrigeable : configuration actuelle, puis anciennes configurations dans leur format d'origine
    var wrap = el('div', 'g-hist'), td = today();
    series(g).slice().reverse().forEach(function(s){
      var host = wrap, n0 = 8, N = n0, body = el('div'), curK = pkey(s, td), known = dict();
      if(s.old){
        host = el('details');
        host.appendChild(el('summary', '', 'Ancienne configuration : ' + cfgLbl(s.rp, s.kind) + (s.to ? ' (jusqu’au ' + dfmt(s.to) + ')' : '')));
        wrap.appendChild(host);
      }
      host.appendChild(body);
      var ks = plist(s, td).filter(function(k){
        known[k] = 1;
        return (expected(s, k) || s.rec[k]) && !(k === curK && !s.old && !g.archivedAt);   // la période en cours se saisit au-dessus
      }).reverse();
      (function draw(){
        body.innerHTML = '';
        if(!ks.length) body.appendChild(el('p', 'hint', 'Aucune période passée pour l’instant.'));
        ks.slice(0, N).forEach(function(k){ var x = ctl(s, k, plabel(s, k), g.name + ' — ' + plabel(s, k), null, !expected(s, k)); x.classList.add('g-h'); body.appendChild(x); });
        if(ks.length > N) body.appendChild(btn('Voir plus', function(){ N += n0; draw(); if(body.lastChild && body.lastChild.tagName === 'BUTTON') body.lastChild.focus(); }));
      })();
      var extra = Object.keys(s.rec).filter(function(k){ return !known[k]; }).sort();
      if(extra.length){   // enregistrements hors calendrier attendu : conservés et consultables, jamais supprimés
        var ex = el('details'); ex.appendChild(el('summary', '', 'Autres enregistrements conservés (' + extra.length + ')'));
        extra.forEach(function(k){ var r = s.rec[k] || {}; ex.appendChild(el('div', 'ck-count', k + ' : ' + (r.value != null ? qtxt(s, k, r.value) : (r.checked ? 'réalisé' : 'non réalisé')))); });
        host.appendChild(ex);
      }
    });
    return wrap;
  }
  function archive(c, g){ g.archivedAt = now(); g.active = false; if(!Array.isArray(g.pauses)) g.pauses = []; g.pauses.push({from: today(), to: null}); g.updatedAt = now(); touch(c); save(); render(); }
  function restore(c, g){ g.archivedAt = null; g.active = true; (g.pauses || []).forEach(function(p){ if(!p.to) p.to = today(); }); g.updatedAt = now(); touch(c); save(); render(); }
  function move(c, g, dir){   // changement d'ordre parmi les lignes actives
    var act = c.goals.filter(function(x){ return !x.archivedAt; }).sort(byOrder), i = act.indexOf(g), j = i + dir;
    if(j < 0 || j >= act.length) return;
    act[i] = act[j]; act[j] = g; act.forEach(function(x, n){ x.order = n; });
    moved = g.id + '|' + dir; touch(c); save(); render();
  }
  function delGoal(c, g){
    var labels = g.archivedAt ? ['Supprimer définitivement', 'Annuler'] : ['Archiver (conserver l’historique)', 'Supprimer définitivement', 'Annuler'];
    window.CloudSync.ask('« ' + g.name + ' »',
      'Supprimer définitivement cette ligne et tout son historique ? Cette action est irréversible.' + (g.archivedAt ? '' : ' L’archivage la retire du suivi courant tout en conservant son historique et ses statistiques.'),
      labels).then(function(i){
        var a = labels[i] || '';
        if(a.indexOf('Archiver') === 0) archive(c, g);
        else if(a.indexOf('Supprimer') === 0){ c.goals = c.goals.filter(function(x){ return x.id !== g.id; }); touch(c); save(); render(); }
      });
  }
  var openHist = {};   // historiques dépliés (conservés d'un rendu à l'autre)
  function renderGoals(c, sec, h){
    var td = today(), act = c.goals.filter(function(g){ return !g.archivedAt; }).sort(byOrder), arch = c.goals.filter(function(g){ return g.archivedAt; }).sort(byOrder), list = el('div');
    function upd(){ var k = goalProg(c); h.counter.textContent = k.d + ' / ' + k.n + ' faits'; h.counter.title = 'Périodes en cours'; }
    function histBtn(g, item){
      var panel = null, b = ibtn('🕘', 'Historique de « ' + g.name + ' »', function(){ openHist[g.id] = !openHist[g.id]; sync(); });
      function sync(){
        var on = !!openHist[g.id]; b.setAttribute('aria-expanded', on ? 'true' : 'false');
        if(on && !panel){ panel = histPanel(g); item.appendChild(panel); }
        else if(!on && panel){ item.removeChild(panel); panel = null; }
      }
      sync(); return b;
    }
    h.acts.appendChild(btn('+ Ligne', function(){ openGoal(c, null); }, 'primary'));
    h.acts.appendChild(ibtn('✏️', 'Modifier la carte', function(){ openDlg(c); }));
    act.forEach(function(g, i){
      var s = curS(g), key = pkey(s, td), item = el('div', 'g-item'), rw = ctl(s, key, g.name, g.name + ' — ' + plabel(s, key), upd, false);
      var pill = el('span', 'pill', repShort(s.rp)), acts = el('div', 'g-acts'), tt = rw.querySelector('.g-title');
      pill.title = repLbl(s.rp) + ' — ' + plabel(s, key); if(tt) tt.title = describe(g);
      item.appendChild(rw);
      var ed = ibtn('✏️', 'Modifier « ' + g.name + ' »', function(){ openGoal(c, g); }); ed.setAttribute('data-line', g.id);
      var up = ibtn('↑', 'Monter « ' + g.name + ' »', function(){ move(c, g, -1); }), dn = ibtn('↓', 'Descendre « ' + g.name + ' »', function(){ move(c, g, 1); });
      up.disabled = i === 0; dn.disabled = i === act.length - 1; up.setAttribute('data-mv', g.id + '|-1'); dn.setAttribute('data-mv', g.id + '|1');
      [ed, ibtn('🎯', 'Objectifs de « ' + g.name + ' »', function(){ openGoal(c, g, true); }), histBtn(g, item), up, dn,
       ibtn('🗑️', 'Supprimer « ' + g.name + ' »', function(){ delGoal(c, g); })].forEach(function(b){ acts.appendChild(b); });
      rw.appendChild(pill); rw.appendChild(acts); list.appendChild(item);
    });
    if(!act.length) list.appendChild(el('p', 'hint empty', 'Aucune ligne active. Ajoute la première avec « + Ligne ».'));
    sec.appendChild(list);
    if(arch.length){
      var ad = el('details'); ad.appendChild(el('summary', '', 'Archivées (' + arch.length + ')'));
      arch.forEach(function(g){
        var item = el('div', 'g-item'), rw = el('div', 'g-row arch'), acts = el('div', 'g-acts');
        rw.appendChild(el('span', 'g-title', g.name));
        rw.appendChild(el('span', 'g-st', describe(g) + ' · archivée le ' + new Date(g.archivedAt).toLocaleDateString('fr-FR')));
        item.appendChild(rw);
        acts.appendChild(histBtn(g, item));
        acts.appendChild(ibtn('↩️', 'Restaurer « ' + g.name + ' »', function(){ restore(c, g); }));
        acts.appendChild(ibtn('🗑️', 'Supprimer « ' + g.name + ' »', function(){ delGoal(c, g); }));
        rw.appendChild(acts); ad.appendChild(item);
      });
      sec.appendChild(ad);
    }
    if(c.items.length){   // lignes d'une ancienne carte standard : jamais perdues
      var sd = el('details'); sd.appendChild(el('summary', '', 'Lignes standard conservées (' + c.items.length + ')'));
      c.items.slice().sort(byOrder).forEach(function(it){ sd.appendChild(row(c, it, function(){})); });
      sec.appendChild(sd);
    }
    upd();
    var f = null, p;
    if(moved){ f = qd(sec, 'mv', moved); if(f && f.disabled){ p = moved.split('|'); f = qd(sec, 'mv', p[0] + '|' + (-p[1])); } }
    else if(focusLine) f = qd(sec, 'line', focusLine);
    moved = null; focusLine = null;
    if(f) f.focus();
  }

  /* ---- Dialogue d'une ligne récurrente (création, modification, 🎯 objectifs) ---- */
  var GOALHINT = {
    check: 'Simple case : tu la coches toi-même à chaque période.',
    time: 'À chaque période, tu saisis le temps réellement réalisé. S’il atteint l’objectif, la case se coche toute seule ; en dessous, la case reste décochée mais le temps compte dans les totaux. Sans objectif, le temps est seulement totalisé.',
    number: 'À chaque période, tu saisis le nombre réellement réalisé. S’il atteint l’objectif, la case se coche toute seule ; en dessous, la case reste décochée mais la valeur compte dans les totaux. Sans objectif, la valeur est seulement totalisée.'
  };
  var KL = {check: 'case à cocher', time: 'temps', number: 'nombre'};
  var gDlg = $('gDialog'), gdTime = timeFields('Objectif de temps'), gdRep = repeatField(false), gCard = null, gEdit = null, gOnly = false;
  $('gdTimeHost').appendChild(gdTime.el); $('gdRepHost').appendChild(gdRep.el);
  function syncKind(){
    var m = $('gdMode').value;
    vis($('gdTimeBox'), m === 'time'); vis($('gdNumBox'), m === 'number');
    $('gdGoalHint').textContent = (GOALHINT[m] || '') + (gOnly ? ' Le nouvel objectif s’applique à partir de maintenant : les périodes passées gardent l’objectif de leur époque.' : '');
  }
  $('gdMode').onchange = syncKind;
  function openGoal(c, g, only){
    gCard = c; gEdit = g || null; gOnly = !!(g && only);
    var k = g ? kindOf(g) : 'check';
    $('gdTitle').textContent = gOnly ? 'Objectifs — ' + g.name : (g ? 'Modifier la ligne' : 'Nouvelle ligne');
    vis($('gdNameBox'), !gOnly);
    $('gdName').value = g ? g.name : ''; $('gdMode').value = KL[k] ? k : 'check';
    gdTime.set(g && k === 'time' && g.target != null ? g.target : null);
    $('gdTarget').value = g && k === 'number' && g.target != null ? g.target : '';
    $('gdUnit').value = g && k === 'number' ? (g.unit || '') : '';
    gdRep.set(g ? repOf(g) : {every: 1, unit: 'day'});
    $('gdErr').textContent = ''; syncKind(); gDlg.showModal();
    if(gOnly) $('gdMode').focus(); else $('gdName').focus();
  }
  $('gdForm').onsubmit = function(e){
    e.preventDefault();
    var g = gEdit, c = gCard, err = $('gdErr'), name = gOnly ? g.name : $('gdName').value.trim(), k = $('gdMode').value, rp = gdRep.get(), target = null, unit = '', td = today();
    if(!name){ err.textContent = 'Donne un titre à la ligne.'; return; }
    if(!isRep(rp)){ err.textContent = 'Indique une répétition valide (nombre entier supérieur ou égal à 1).'; return; }
    if(k === 'time'){
      var tv = gdTime.read();
      if(tv.bad){ err.textContent = 'L’objectif de temps doit être composé de nombres supérieurs ou égaux à 0.'; return; }
      target = !tv.empty && tv.v > 0 ? tv.v : null; unit = 'min';
    }else if(k === 'number'){
      var ti = $('gdTarget'), raw = ti.value.trim(), nv = raw === '' ? null : parseFloat(raw.replace(',', '.'));
      if((ti.validity && ti.validity.badInput) || (nv !== null && !(nv >= 0))){ err.textContent = 'L’objectif doit être un nombre supérieur ou égal à 0.'; return; }
      target = nv > 0 ? nv : null; unit = $('gdUnit').value.trim();
    }else k = 'check';
    var mode = k === 'check' ? 'check' : 'quantity';
    if(!g){ g = newLine(name, {every: rp.every, unit: rp.unit}, k, target, unit, nextOrder(c.goals)); c.goals.push(g); }
    else{
      var oldK = kindOf(g), oldRp = repOf(g);
      if(!isObj(g.records)) g.records = {};
      if(!Array.isArray(g.legacy)) g.legacy = [];
      if(!Array.isArray(g.targetLog)) g.targetLog = [];
      if(!sameRep(oldRp, rp) || oldK !== k){
        if(Object.keys(g.records).length){   // rien n'est supprimé ni converti : l'ancienne configuration est archivée avec ses données
          if(!confirm('« ' + g.name + ' » possède déjà un historique.\n\nRien n’est supprimé ni converti : l’ancienne configuration (' + repLbl(oldRp) + ' · ' + KL[oldK] +
            ') est archivée avec ses données. Elle reste consultable et corrigeable dans « Historique » et continue de compter dans les statistiques.\n\nLe suivi repart d’aujourd’hui avec la nouvelle configuration (' +
            repLbl(rp) + ' · ' + KL[k] + '). Continuer ?')) return;
          var old = {repeat: oldRp, trackingMode: g.trackingMode, target: g.target, unit: g.unit, from: g.since, to: td, records: g.records, targetLog: g.targetLog};
          if(g.frequency !== undefined) old.frequency = g.frequency;
          if(g.quantityKind) old.quantityKind = g.quantityKind;
          g.legacy.push(old);
          g.records = {}; g.since = td;
        }
        g.targetLog = [];
      }else if(mode === 'quantity' && (g.target !== target || (g.unit || '') !== unit)){   // seul l'objectif change : le passé garde l'objectif de son époque
        var s0 = curS(g), ck = pkey(s0, td);
        if(!g.targetLog.some(function(x){ return x.until === ck; })) g.targetLog.push({until: ck, target: g.target, unit: g.unit});
      }
      g.name = name; g.repeat = {every: rp.every, unit: rp.unit}; g.trackingMode = mode;
      g.target = mode === 'quantity' ? target : null; g.unit = mode === 'quantity' ? unit : '';
      if(mode === 'quantity') g.quantityKind = k; else delete g.quantityKind;
      g.updatedAt = now(); withFreq(g);
      var s1 = curS(g), k1 = pkey(s1, td), r = s1.rec[k1];
      if(r && mode === 'quantity'){ r.targetAtTime = g.target; r.unitAtTime = g.unit; r.checked = res(s1, k1) === true; r.updatedAt = now(); }
    }
    touch(c); save(); gDlg.close(); focusLine = g.id; render();
  };
  $('gdCancel').onclick = function(){ gDlg.close(); };

  /* ---- Dashboards : briques communes (graphiques SVG maison, filtres) ---- */
  function addUnit(map, u, v){ var label = (u || '').trim(), k = 'u:' + label.toLowerCase(), o = map[k] || (map[k] = {unit: label, sum: 0}); o.sum += v; }
  function unitsTxt(map){ return Object.keys(map).map(function(k){ return num(map[k].sum) + (map[k].unit ? ' ' + map[k].unit : ''); }).join(' · '); }
  function svg(tag, attrs, parent){ var n = document.createElementNS(NS, tag), k; for(k in attrs) n.setAttribute(k, attrs[k]); if(parent) parent.appendChild(n); return n; }
  function section(title, tip){
    var s = el('section', 'card'), h2 = el('h2', '', title), i;
    if(tip){ i = el('span', 'info', 'i'); i.tabIndex = 0; i.setAttribute('data-tip', tip); i.setAttribute('aria-label', tip); i.setAttribute('role', 'note'); h2.appendChild(i); }
    s.appendChild(h2); return s;
  }
  function statTile(label, value, strong){ var d = el('div', 'stat' + (strong ? ' total' : '')); d.appendChild(el('span', '', label)); d.appendChild(el('b', '', String(value))); return d; }
  function tbl(heads, rows){
    var w = el('div', 'tablewrap'), t = el('table'), th = el('thead'), tb = el('tbody'), tr = el('tr');
    heads.forEach(function(x){ var c = el('th', '', x); c.scope = 'col'; tr.appendChild(c); }); th.appendChild(tr);
    rows.forEach(function(r){ var x = el('tr'); r.forEach(function(v){ x.appendChild(el('td', '', String(v))); }); tb.appendChild(x); });
    t.appendChild(th); t.appendChild(tb); w.appendChild(t); return w;
  }
  function altTable(heads, rows){ var d = el('details', 'alt'); d.appendChild(el('summary', '', 'Voir les données')); d.appendChild(tbl(heads, rows)); return d; }
  function chartBox(node){ var d = el('div', 'chart'); d.appendChild(node); return d; }
  function lg(cls, color, txt){ var s = el('span', 'lg'), i = el('i', cls); if(color) i.style.setProperty('--c', color); s.appendChild(i); s.appendChild(el('span', '', txt)); return s; }
  function hbList(items){   // barres horizontales : nom, barre, valeur écrite
    var ul = el('ul', 'hb');
    items.forEach(function(it){
      var li = el('li'), t = el('span', 'hb-t'), i = el('i');
      i.style.width = Math.max(0, Math.min(100, it.pct)) + '%'; if(it.color) i.style.background = it.color;
      t.appendChild(i); li.appendChild(el('span', 'hb-n', it.name)); li.appendChild(t); li.appendChild(el('span', 'hb-v', it.txt)); ul.appendChild(li);
    });
    return ul;
  }
  function frame(o, n){   // cadre commun : lignes de repère + graduations
    var W = 640, H = 210, L = 40, R = 12, T = 12, B = 24, max = o.max || 1;
    var root = svg('svg', {viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.aria});
    [0, .5, 1].forEach(function(f){
      var y = T + (1 - f) * (H - T - B);
      svg('line', {x1: L, x2: W - R, y1: y, y2: y, style: 'stroke:var(--line)'}, root);
      svg('text', {x: L - 5, y: y + 4, 'text-anchor': 'end', style: 'fill:var(--muted);font-size:11px'}, root).textContent = num(Math.round(max * f * 10) / 10) + (o.suffix || '');
    });
    return {root: root, W: W, H: H, L: L, R: R, T: T, B: B, max: max, idx: n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : (n === 2 ? [0, 1] : (n ? [0] : [])),
      y: function(v){ return T + (1 - Math.min(v, max) / max) * (H - T - B); }};
  }
  function lineChart(o){   // o : {labels, series:[{name,color,vals,main}], max, suffix, aria, gold}
    var n = o.labels.length, f = frame(o, n), X = function(i){ return n > 1 ? f.L + i * (f.W - f.L - f.R) / (n - 1) : (f.L + f.W - f.R) / 2; };
    f.idx.forEach(function(i, j){
      svg('text', {x: X(i).toFixed(1), y: f.H - 6, 'text-anchor': n === 1 ? 'middle' : (j === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle')), style: 'fill:var(--muted);font-size:11px'}, f.root).textContent = o.labels[i];
    });
    o.series.forEach(function(s){
      var d = '', pen = false;
      s.vals.forEach(function(v, i){ if(v === null){ pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + f.y(v).toFixed(1); pen = true; });
      if(d) svg('path', {d: d, fill: 'none', style: 'stroke:' + s.color + ';stroke-width:' + (s.main ? 3.2 : 1.6) + ';stroke-linejoin:round;stroke-linecap:round' + (s.main ? '' : ';opacity:.9')}, f.root);
      if(s.main || n <= 31) s.vals.forEach(function(v, i){
        if(v === null) return;
        var full = o.gold && s.main && v >= f.max;
        var c = svg('circle', {cx: X(i).toFixed(1), cy: f.y(v).toFixed(1), r: full ? 5 : (s.main ? 3.2 : 2.2), style: 'fill:' + (full ? 'var(--gold)' : s.color) + (full ? ';stroke:var(--card);stroke-width:1.5' : '')}, f.root);
        svg('title', {}, c).textContent = o.labels[i] + ' — ' + s.name + ' : ' + num(v) + (o.suffix || '');
      });
    });
    return f.root;
  }
  function barChart(o){   // o : {labels, short, vals, colors, max, suffix, aria}
    var n = o.labels.length, f = frame(o, n), bw = (f.W - f.L - f.R) / Math.max(n, 1), step = Math.ceil(n / 12) || 1;
    o.vals.forEach(function(v, i){
      var hh = Math.min(v, f.max) / f.max * (f.H - f.T - f.B), x = f.L + i * bw;
      var r = svg('rect', {x: (x + bw * .15).toFixed(1), y: (f.H - f.B - hh).toFixed(1), width: (bw * .7).toFixed(1), height: hh.toFixed(1), rx: 3, style: 'fill:' + (o.colors ? o.colors[i] : 'var(--accent)')}, f.root);
      svg('title', {}, r).textContent = o.labels[i] + ' : ' + num(v) + (o.suffix || '');
      if(i % step === 0) svg('text', {x: (x + bw / 2).toFixed(1), y: f.H - 6, 'text-anchor': 'middle', style: 'fill:var(--muted);font-size:11px'}, f.root).textContent = o.short ? o.short[i] : o.labels[i];
    });
    return f.root;
  }
  function heat(map, from, to, aria){   // carte des jours : une colonne par semaine, lundi en haut
    var S = 14, G = 3, L = 18, start = mondayOfKey(from), cols = Math.floor(dd(start, to) / 7) + 1, W = L + cols * (S + G), H = 7 * (S + G);
    var root = svg('svg', {viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': aria, style: 'max-width:' + Math.round(W * 1.5) + 'px'}), k = from, i = 0, m, d, p, r;
    ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach(function(t, j){ svg('text', {x: 0, y: j * (S + G) + S - 3, style: 'fill:var(--muted);font-size:10px'}, root).textContent = t; });
    while(k <= to && i++ < 400){
      m = map[k]; d = dd(start, k); p = m && m.n ? m.ok / m.n : -1;
      r = svg('rect', {x: L + Math.floor(d / 7) * (S + G), y: (d % 7) * (S + G), width: S, height: S, rx: 3,
        style: p < 0 ? 'fill:var(--line);opacity:.45' : (p >= 1 ? 'fill:var(--gold)' : (p > 0 ? 'fill:var(--accent);opacity:' + (.3 + .6 * p).toFixed(2) : 'fill:var(--warn);opacity:.55'))}, root);
      svg('title', {}, r).textContent = dfmt(k) + ' : ' + (p < 0 ? 'rien d’attendu' : m.ok + ' / ' + m.n + (m.cur ? ' (en cours)' : ''));
      k = addDays(k, 1);
    }
    return root;
  }
  function field(txt, node, lab){ var f = el(lab ? 'label' : 'div', lab ? '' : 'fl'); f.appendChild(el('span', '', txt)); f.appendChild(node); return f; }

  var DF = {};   // état des filtres par dashboard (conservé pendant la session)
  function dfOf(kind){ return DF[kind] || (DF[kind] = {preset: '30d', from: '', to: '', lines: null, rep: '', vis: {}, subj: null, type: ''}); }
  var PRESETS = [['today', 'Aujourd’hui'], ['week', 'Cette semaine'], ['lastweek', 'Semaine dernière'], ['7d', '7 derniers jours'], ['30d', '30 derniers jours'], ['month', 'Ce mois-ci'],
    ['lastmonth', 'Mois dernier'], ['12w', '12 dernières semaines'], ['year', 'Cette année'], ['all', 'Tout'], ['custom', 'Personnalisé']];
  function presetRange(p, lo){
    var t = today(), d = pdate(t), y = d.getFullYear(), m = d.getMonth(), mon = mondayOfKey(t);
    switch(p){
      case 'today': return [t, t];
      case 'week': return [mon, addDays(mon, 6)];
      case 'lastweek': return [addDays(mon, -7), addDays(mon, -1)];
      case '7d': return [addDays(t, -6), t];
      case '30d': return [addDays(t, -29), t];
      case 'month': return [dkey(new Date(y, m, 1)), dkey(new Date(y, m + 1, 0))];
      case 'lastmonth': return [dkey(new Date(y, m - 1, 1)), dkey(new Date(y, m, 0))];
      case '12w': return [addDays(mon, -77), addDays(mon, 6)];
      case 'year': return [dkey(new Date(y, 0, 1)), dkey(new Date(y, 11, 31))];
      case 'all': return [lo && lo < t ? lo : t, t];
    }
    return null;
  }
  function periodFilter(st, lo, onChange){   // préréglages + deux dates ; toute modification manuelle passe en « Personnalisé »
    var box = el('div', 'pf'), ps = el('select'), a = el('input'), b = el('input'), msg = el('span', 'hint');
    ps.setAttribute('aria-label', 'Préréglage de période'); a.type = 'date'; b.type = 'date'; a.setAttribute('aria-label', 'Du'); b.setAttribute('aria-label', 'Au'); msg.setAttribute('role', 'status');
    PRESETS.forEach(function(p){ opt(ps, p[0], p[1]); });
    function preset(){ var r = presetRange(st.preset, lo); if(r){ st.from = r[0]; st.to = r[1]; } }
    function fillIn(){ ps.value = st.preset; a.value = st.from; b.value = st.to; }
    if(st.preset === 'custom' && !(DKEY.test(st.from) && DKEY.test(st.to))) st.preset = '30d';
    preset(); fillIn();
    ps.onchange = function(){ st.preset = ps.value; msg.textContent = ''; preset(); fillIn(); onChange(); };
    function manual(isFrom){
      if(!DKEY.test(a.value) || !DKEY.test(b.value)){ msg.textContent = 'Indique deux dates valides.'; return; }
      st.from = a.value; st.to = b.value; st.preset = 'custom'; msg.textContent = '';
      if(st.from > st.to){ if(isFrom) st.to = st.from; else st.from = st.to; msg.textContent = 'Le début était après la fin : dates alignées sur la même journée.'; }
      fillIn(); onChange();
    }
    a.onchange = function(){ manual(true); }; b.onchange = function(){ manual(false); };
    box.appendChild(ps); box.appendChild(el('span', '', 'du')); box.appendChild(a); box.appendChild(el('span', '', 'au')); box.appendChild(b); box.appendChild(msg);
    return box;
  }
  var msOpen = null;   // menu à cases actuellement ouvert
  document.addEventListener('click', function(e){ if(msOpen && !msOpen.box.contains(e.target)) msOpen.close(); });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && msOpen){ var m = msOpen; m.close(); m.btn.focus(); } });
  function multiSelect(label, items, st, key, allTxt, one, many, onChange){   // st[key] : null (tout) ou tableau d'ids
    var box = el('div', 'ms'), panel = el('div', 'ms-panel'), cbs = [], all, me;
    var b = btn('', function(){
      if(msOpen === me){ me.close(); return; }
      if(msOpen) msOpen.close();
      vis(panel, true); b.setAttribute('aria-expanded', 'true'); msOpen = me; all.focus();
    }, 'ms-btn');
    me = {box: box, btn: b, close: function(){ vis(panel, false); b.setAttribute('aria-expanded', 'false'); if(msOpen === me) msOpen = null; }};
    b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false'); panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', label); vis(panel, false);
    function line(txt, bold){ var l = el('label', 'ms-opt' + (bold ? ' b' : '')), i = el('input'); i.type = 'checkbox'; l.appendChild(i); l.appendChild(el('span', '', txt)); panel.appendChild(l); return i; }
    function sync(){
      var n = cbs.filter(function(x){ return x.checked; }).length, txt = n === cbs.length ? allTxt : n + ' ' + (n > 1 ? many : one);
      all.checked = n > 0 && n === cbs.length; all.indeterminate = n > 0 && n < cbs.length;
      b.textContent = txt + ' ▾'; b.setAttribute('aria-label', label + ' : ' + txt);
    }
    function commit(){
      var ids = items.filter(function(x, i){ return cbs[i].checked; }).map(function(x){ return x.id; });
      st[key] = ids.length === items.length ? null : ids; sync(); onChange();
    }
    all = line('Toutes', true);
    all.onchange = function(){ var on = all.checked; cbs.forEach(function(x){ x.checked = on; }); commit(); };
    items.forEach(function(it){ var i = line(it.name); i.checked = st[key] === null || st[key].indexOf(it.id) >= 0; i.onchange = commit; cbs.push(i); });
    box.appendChild(b); box.appendChild(panel); sync(); return box;
  }
  function noCard(host, txt, flag){
    var flags = isObj(data.defaultCards) ? data.defaultCards : {}, sec = el('section', 'card');
    sec.appendChild(el('p', 'hint empty', txt + (flags[flag] ? '' : ' La carte par défaut sera créée automatiquement dès que la synchronisation avec ton compte aura réussi.')));
    host.appendChild(sec);
  }

  /* ---- Dashboard Sport / Ménage ---- */
  function calcLine(L, F, T, td){   // réussite par période terminée ; la période en cours n'est jamais un échec ; totaux par unité
    var g = L.g;
    L.ev = 0; L.ok = 0; L.min = 0; L.time = false; L.units = dict(); L.days = dict(); L.cur = undefined; L.cs = null; L.curTxt = '—'; L.run = 0; L.best = 0; L.fails = [];
    series(g).forEach(function(s){
      var curK = !s.old && !g.archivedAt ? pkey(s, td) : null, run = 0, best = 0;
      plist(s, td).forEach(function(k){
        if(!expected(s, k)) return;
        var x = res(s, k), isCur = k === curK, e = pEnd(s, k), r = s.rec[k], b;
        if(isCur){
          L.cs = s; L.cur = x;
          L.curTxt = s.m === 'quantity' ? (r && r.value != null ? ratio(s, k, r.value) : 'rien de saisi') : (x ? '✓ fait' : 'à faire');
        }
        if(x === null) return;   // sans objectif : ni réussite ni échec
        if(isCur || e > td) e = td;
        b = L.days[e] || (L.days[e] = {n: 0, ok: 0}); b.n++; if(x) b.ok++;
        if(isCur){ b.cur = true; if(x) run++; }
        else{
          if(x) run++; else run = 0;
          if(e >= F && e <= T){ L.ev++; if(x) L.ok++; else L.fails.push({e: e, txt: plabel(s, k)}); }
        }
        if(run > best) best = run;
      });
      if(!s.old){ L.run = run; L.best = best; }
      Object.keys(s.rec).forEach(function(k){   // valeurs saisies dans la fenêtre : temps à part, nombres par unité, jamais mélangés
        var r = s.rec[k], e;
        if(!r || r.value == null || !DKEY.test(k)) return;
        e = pEnd(s, k); if(e > td) e = td; if(e < F || e > T) return;
        if(s.kind === 'time'){ L.min += r.value; L.time = true; } else if(s.m === 'quantity') addUnit(L.units, unitOf(s, k), r.value);
      });
    });
  }
  function dashGoals(kind, host){
    var st = dfOf(kind), cards = data.cards.filter(function(c){ return c.type === kind; }), lines = [], lo = today();
    if(!cards.length){ noCard(host, 'Aucune carte ' + (TYPELBL[kind] || kind) + '.', kind); return; }
    cards.forEach(function(c){ c.goals.slice().sort(byOrder).forEach(function(g){
      lines.push({c: c, g: g, id: g.id, name: (cards.length > 1 ? c.title + ' › ' : '') + g.name + (g.archivedAt ? ' (archivée)' : ''), color: PAL[lines.length % PAL.length]});
      series(g).forEach(function(s){ if(DKEY.test(s.from || '') && s.from < lo) lo = s.from; });
    }); });
    if(st.lines) st.lines = st.lines.filter(function(id){ return lines.some(function(L){ return L.id === id; }); });
    var ctr = el('section', 'card'), cc = el('div', 'controls'), out = el('div'), rs = el('select');
    cc.appendChild(field('Période', periodFilter(st, lo, draw)));
    cc.appendChild(field('Ligne', multiSelect('Lignes', lines, st, 'lines', 'Toutes les lignes', 'ligne', 'lignes', draw)));
    opt(rs, '', 'Toutes'); UNITS.forEach(function(u){ var t = UL[u][1]; opt(rs, u, t.charAt(0).toUpperCase() + t.slice(1)); });
    rs.value = st.rep; rs.onchange = function(){ st.rep = rs.value; draw(); };
    cc.appendChild(field('Répétition', rs, true));
    ctr.appendChild(cc); host.appendChild(ctr); host.appendChild(out);
    function draw(){
      out.innerHTML = '';
      var td = today(), F = st.from, T = st.to, hi = T > td ? td : T;
      var selL = lines.filter(function(L){ return (st.lines === null || st.lines.indexOf(L.id) >= 0) && (!st.rep || repOf(L.g).unit === st.rep); });
      if(!selL.length){ out.appendChild(el('p', 'hint empty', lines.length ? 'Aucune ligne ne correspond aux filtres.' : 'Aucune ligne pour l’instant : ajoute-en depuis l’onglet Checklists.')); return; }
      var ev = 0, ok = 0, min = 0, anyTime = false, units = dict(), dayAll = dict(), fails = [], tdN = 0, tdOk = 0, wkN = 0, wkOk = 0, otN = 0, otOk = 0, nAct = 0, nArch = 0;
      selL.forEach(function(L){
        calcLine(L, F, T, td);
        ev += L.ev; ok += L.ok; min += L.min; if(L.time) anyTime = true;
        Object.keys(L.units).forEach(function(k){ addUnit(units, L.units[k].unit, L.units[k].sum); });
        Object.keys(L.days).forEach(function(k){ var m = L.days[k], a = dayAll[k] || (dayAll[k] = {n: 0, ok: 0}); a.n += m.n; a.ok += m.ok; if(m.cur) a.cur = true; });
        L.fails.forEach(function(f){ fails.push({e: f.e, txt: f.txt, name: L.name}); });
        if(L.g.archivedAt) nArch++; else nAct++;
        if(L.cs && (L.cur === true || L.cur === false)){
          var rp = L.cs.rp, one = rp.every === 1;
          if(one && rp.unit === 'day'){ tdN++; if(L.cur) tdOk++; } else if(one && rp.unit === 'week'){ wkN++; if(L.cur) wkOk++; } else { otN++; if(L.cur) otOk++; }
        }
      });
      // séries de jours complets (toutes les périodes échues ce jour-là sont réussies) ; la période en cours ne casse jamais la série
      var keys = Object.keys(dayAll).sort(), run = 0, best = 0, runAt = dict();
      keys.forEach(function(k){ var m = dayAll[k]; if(m.ok === m.n) run++; else if(!m.cur) run = 0; if(run > best) best = run; runAt[k] = run; });

      var s1 = section('Indicateurs clés', 'Réussite : part des périodes terminées et réussies sur la plage choisie. La période en cours n’est jamais comptée comme un échec. Série : jours complets consécutifs.'), tiles = el('div', 'stats');
      tiles.appendChild(statTile('Lignes actives', nAct));
      if(nArch) tiles.appendChild(statTile('Archivées', nArch));
      if(tdN) tiles.appendChild(statTile('Aujourd’hui', tdOk + ' / ' + tdN));
      if(wkN) tiles.appendChild(statTile('Cette semaine', wkOk + ' / ' + wkN));
      if(otN) tiles.appendChild(statTile('Autres périodes en cours', otOk + ' / ' + otN));
      tiles.appendChild(statTile('Réussite', ev ? Math.round(ok / ev * 100) + ' % (' + ok + ' / ' + ev + ')' : '—', true));
      tiles.appendChild(statTile('Série actuelle', run + ' j'));
      tiles.appendChild(statTile('Meilleure série', best + ' j'));
      if(anyTime) tiles.appendChild(statTile('Temps réalisé', fmtMin(min)));
      Object.keys(units).forEach(function(k){ tiles.appendChild(statTile('Total' + (units[k].unit ? ' · ' + units[k].unit : ''), num(units[k].sum))); });
      s1.appendChild(tiles);
      if(!ev) s1.appendChild(el('p', 'hint', 'Aucune période terminée sur cette plage : la réussite s’affichera dès la première période achevée.'));
      out.appendChild(s1);

      function totTxt(L){
        var p = [], u = unitsTxt(L.units);
        if(L.time) p.push(fmtMin(L.min)); if(u) p.push(u);
        if(!p.length && kindOf(L.g) === 'number' && !L.g.archivedAt) p.push('0' + (L.g.unit ? ' ' + L.g.unit : ''));
        return p.join(' · ') || '—';
      }
      if(hi >= F){
        var byDay = dd(F, hi) + 1 <= 31, bk = [], k = byDay ? F : mondayOfKey(F), guard = 0, fm = {day: 'numeric', month: 'short'};
        while(k <= hi && guard++ < 600){ bk.push(k); k = addDays(k, byDay ? 1 : 7); }
        var lab = bk.map(function(b){ return (byDay ? '' : 'sem. du ') + dfmt(b, fm); });
        var pct = function(map, b){ var n = 0, o = 0, i, m; for(i = 0; i < (byDay ? 1 : 7); i++){ m = map[addDays(b, i)]; if(m){ n += m.n; o += m.ok; } } return n ? Math.round(o / n * 100) : null; };
        var multi = selL.length > 1, shown = function(L){ return has(st.vis, L.id) ? st.vis[L.id] : selL.length <= 8; };
        var main = bk.map(function(b){ return pct(dayAll, b); }), ser = [], mainName = multi ? 'Sélection' : selL[0].name;
        if(multi) selL.forEach(function(L){ if(shown(L)) ser.push({name: L.name, color: L.color, vals: bk.map(function(b){ return pct(L.days, b); })}); });
        ser.push({name: mainName, color: 'var(--accent)', vals: main, main: true});
        var s2 = section('Assiduité', 'Part des lignes attendues réellement faites, par ' + (byDay ? 'jour' : 'semaine') + '. Les points dorés marquent les ' + (byDay ? 'jours' : 'semaines') + ' à 100 %.'), lgd = el('div', 'legend');
        if(main.some(function(x){ return x !== null; })){
          s2.appendChild(chartBox(lineChart({labels: lab, series: ser, max: 100, suffix: ' %', gold: true, aria: 'Assiduité par ' + (byDay ? 'jour' : 'semaine') + ' du ' + dfmt(F) + ' au ' + dfmt(hi)})));
          lgd.appendChild(lg('k-main', '', mainName)); lgd.appendChild(lg('k-dot', 'var(--gold)', '100 %'));
          if(multi) selL.forEach(function(L){
            var on = shown(L), b = btn('', function(){ st.vis[L.id] = !on; draw(); var again = qd(out, 'lg', L.id); if(again) again.focus(); }, 'lgb' + (on ? '' : ' off')), sw = el('i', 'k-line');
            sw.style.setProperty('--c', L.color); b.appendChild(sw); b.appendChild(el('span', '', L.name));
            b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.setAttribute('data-lg', L.id); b.title = on ? 'Masquer la courbe' : 'Afficher la courbe';
            lgd.appendChild(b);
          });
          s2.appendChild(lgd);
          if(selL.length > 8) s2.appendChild(el('p', 'hint', 'Plus de 8 lignes : les courbes par ligne sont masquées par défaut. Active dans la légende celles que tu veux comparer.'));
          s2.appendChild(altTable(['Période', mainName + ' (%)'], bk.map(function(b, i){ return [lab[i], main[i] === null ? '—' : main[i]]; })));
        }else s2.appendChild(el('p', 'hint empty', 'Aucune période attendue sur cette plage.'));
        out.appendChild(s2);

        var hf = dd(F, hi) > 181 ? addDays(hi, -181) : F, s3 = section('Carte des jours', 'Chaque case est un jour : plus elle est foncée, plus la part de lignes faites est élevée. Doré : 100 %.'), l3 = el('div', 'legend');
        var wd = [0, 1, 2, 3, 4, 5, 6].map(function(){ return [0, 0]; }), k2 = hf, g2 = 0, m2, w2;
        while(k2 <= hi && g2++ < 400){ m2 = dayAll[k2]; if(m2 && m2.n){ w2 = dd(mondayOfKey(k2), k2); wd[w2][1]++; if(m2.ok === m2.n) wd[w2][0]++; } k2 = addDays(k2, 1); }
        s3.appendChild(chartBox(heat(dayAll, hf, hi, 'Carte des jours du ' + dfmt(hf) + ' au ' + dfmt(hi))));
        [['var(--line)', 'rien d’attendu'], ['var(--warn)', '0 %'], ['var(--accent)', 'partiel'], ['var(--gold)', '100 %']].forEach(function(x){ l3.appendChild(lg('k-dot', x[0], x[1])); });
        s3.appendChild(l3);
        if(hf !== F) s3.appendChild(el('p', 'hint', 'Affichage limité aux 26 dernières semaines de la période.'));
        s3.appendChild(altTable(['Jour', 'Jours complets', 'Jours suivis'], ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'].map(function(n, i){ return [n, wd[i][0], wd[i][1]]; })));
        out.appendChild(s3);

        var prev = 0; keys.forEach(function(x){ if(x < F) prev = runAt[x]; });
        var rv = bk.map(function(b){ var i, x; for(i = 0; i < (byDay ? 1 : 7); i++){ x = addDays(b, i); if(x > hi) break; if(runAt[x] !== undefined) prev = runAt[x]; } return prev; });
        var s4 = section('Évolution des séries', 'Nombre de jours complets consécutifs, relevé à chaque ' + (byDay ? 'jour' : 'fin de semaine') + '.');
        s4.appendChild(chartBox(lineChart({labels: lab, series: [{name: 'Série', color: 'var(--ok)', vals: rv, main: true}], max: Math.max(1, Math.max.apply(null, rv.concat([1]))), suffix: ' j', aria: 'Évolution de la série de jours complets'})));
        var l4 = el('div', 'legend'); l4.appendChild(lg('k-line', 'var(--ok)', 'Série de jours complets')); s4.appendChild(l4);
        s4.appendChild(altTable(['Période', 'Série (jours)'], bk.map(function(b, i){ return [lab[i], rv[i]]; })));
        out.appendChild(s4);
      }else out.appendChild(el('p', 'hint empty', 'La période choisie est entièrement à venir : rien à tracer pour l’instant.'));

      var s5 = section('Réalisé par ligne', 'Barre : taux de réussite sur la plage. À droite : périodes réussies / terminées et total réalisé.');
      s5.appendChild(hbList(selL.map(function(L){ return {name: L.name, pct: L.ev ? L.ok / L.ev * 100 : 0, color: L.color, txt: (L.ev ? Math.round(L.ok / L.ev * 100) + ' % · ' + L.ok + '/' + L.ev : '—') + (totTxt(L) !== '—' ? ' · ' + totTxt(L) : '')}; })));
      out.appendChild(s5);
      if(selL.length > 1 && ok){
        var s6 = section('Répartition par ligne', 'Part de chaque ligne dans les périodes réussies de la plage.');
        s6.appendChild(hbList(selL.filter(function(L){ return L.ok; }).sort(function(a, b){ return b.ok - a.ok; }).map(function(L){ return {name: L.name, pct: L.ok / ok * 100, color: L.color, txt: Math.round(L.ok / ok * 100) + ' % · ' + L.ok}; })));
        out.appendChild(s6);
      }

      var s7 = section('Détail par ligne', kind === 'menage' ? 'Les lignes les plus oubliées en premier.' : ''), sorted = selL.slice();
      if(kind === 'menage') sorted.sort(function(a, b){ var x = a.ev ? a.ok / a.ev : 2, y = b.ev ? b.ok / b.ev : 2; return x - y; });
      s7.appendChild(tbl(['Ligne', 'Répétition', 'Objectif', 'Réussite', 'Série', 'Total réalisé', 'Période en cours'], sorted.map(function(L){
        return [L.name, repLbl(repOf(L.g)), objTxt(L.g) || '—', L.ev ? Math.round(L.ok / L.ev * 100) + ' % (' + L.ok + ' / ' + L.ev + ')' : '—', L.run + ' (max ' + L.best + ')', totTxt(L), L.g.archivedAt ? '—' : L.curTxt];
      })));
      out.appendChild(s7);

      var s8 = section(kind === 'menage' ? 'Derniers oublis' : 'Dernières périodes non atteintes');
      fails.sort(function(a, b){ return a.e < b.e ? 1 : (a.e > b.e ? -1 : 0); });
      if(!fails.length) s8.appendChild(el('p', 'hint empty', ev ? 'Aucun oubli sur cette plage. Bravo !' : 'Rien à signaler pour l’instant.'));
      else{ var ul = el('ul'); fails.slice(0, 8).forEach(function(f){ ul.appendChild(el('li', '', f.name + ' — ' + f.txt)); }); s8.appendChild(ul); }
      out.appendChild(s8);

      if(cards.length > 1){
        var s9 = section('Par carte');
        s9.appendChild(tbl(['Carte', 'Lignes', 'Réussite'], cards.map(function(c){
          var n = 0, a = 0, b = 0; selL.forEach(function(L){ if(L.c === c){ n++; a += L.ok; b += L.ev; } });
          return [c.icon + ' ' + c.title, n, b ? Math.round(a / b * 100) + ' % (' + a + ' / ' + b + ')' : '—'];
        })));
        out.appendChild(s9);
      }
    }
    draw();
  }

  /* ---- Dashboard Devoirs ---- */
  function dashDevoirs(host){
    var st = dfOf('devoirs'), cards = data.cards.filter(isDevoirs), td = today(), all = [], subs = [], kinds = [], seen = dict(), lo = td;
    if(!cards.length){ noCard(host, 'Aucune carte « Devoirs ».', 'devoirs'); return; }
    cards.forEach(function(c){
      var R = roles(c);
      [[R.subject, subs], [R.kind, kinds]].forEach(function(p){
        if(p[0]) (p[0].options || []).forEach(function(x){ if(!seen[x.id]){ seen[x.id] = 1; p[1].push({id: x.id, name: x.name, color: colr(x)}); } });
      });
      (c.rows || []).forEach(function(r){
        var val = isObj(r.values) ? r.values : {}, subj = R.subject ? val[R.subject.id] : null, kd = R.kind ? val[R.kind.id] : null, desc = R.desc && !nil(val[R.desc.id]) ? String(val[R.desc.id]) : '';
        var due = R.due && DKEY.test(val[R.due.id] || '') ? val[R.due.id] : null, done = R.done ? val[R.done.id] === true : false, at = null;
        if(done) at = DKEY.test(r.doneAt || '') ? r.doneAt : (r.updatedAt && !isNaN(Date.parse(r.updatedAt)) ? dkey(new Date(r.updatedAt)) : null);
        all.push({subj: subj, kind: kd, desc: desc, due: due, done: done, at: at});
        (Array.isArray(r.log) ? r.log : []).forEach(function(l){   // occurrences passées d'une ligne répétée
          if(l && DKEY.test(l.day || '')) all.push({subj: subj, kind: kd, desc: desc, due: DKEY.test(l.due || '') ? l.due : null, done: true, at: l.day});
        });
      });
    });
    all.forEach(function(x){ if(x.at && x.at < lo) lo = x.at; });
    if(st.subj) st.subj = st.subj.filter(function(id){ return subs.some(function(o){ return o.id === id; }); });
    var ctr = el('section', 'card'), cc = el('div', 'controls'), out = el('div'), ts = el('select');
    cc.appendChild(field('Période', periodFilter(st, lo, draw)));
    if(subs.length) cc.appendChild(field('Matière', multiSelect('Matières', subs, st, 'subj', 'Toutes les matières', 'matière', 'matières', draw)));
    opt(ts, '', 'Tous'); kinds.forEach(function(o){ opt(ts, o.id, o.name); });
    ts.value = st.type; if(ts.value !== st.type){ st.type = ''; ts.value = ''; }
    ts.onchange = function(){ st.type = ts.value; draw(); };
    cc.appendChild(field('Type', ts, true));
    ctr.appendChild(cc); host.appendChild(ctr); host.appendChild(out);
    function nameOf(list, id, none){ var o = list.filter(function(x){ return x.id === id; })[0]; return o ? o.name : none; }
    function draw(){
      out.innerHTML = '';
      if(!all.length){ out.appendChild(el('p', 'hint empty', 'Aucun devoir pour l’instant. Ajoute-les dans la carte « Devoirs » de l’onglet Checklists.')); return; }
      var F = st.from, T = st.to, hi = T > td ? td : T, fm = {day: 'numeric', month: 'short'};
      var rows = all.filter(function(x){ return (st.subj === null || st.subj.indexOf(x.subj) >= 0) && (!st.type || x.kind === st.type); });
      var byDue = function(a, b){ return a.due < b.due ? -1 : (a.due > b.due ? 1 : 0); };
      var todo = rows.filter(function(x){ return !x.done; }), late = todo.filter(function(x){ return x.due && x.due < td; });
      var mon = mondayOfKey(td), sun = addDays(mon, 6);
      var week = todo.filter(function(x){ return x.due && x.due >= mon && x.due <= sun; });
      var ctrl = todo.filter(function(x){ return x.kind === 'controle' && x.due && x.due >= td; }).sort(byDue);
      var done = rows.filter(function(x){ return x.done && x.at && x.at >= F && x.at <= T; });
      var timed = done.filter(function(x){ return x.due; }), onTime = timed.filter(function(x){ return x.at <= x.due; });

      var s1 = section('Indicateurs clés', 'À faire, en retard, cette semaine et contrôles : état actuel. Faits et taux à temps : sur la période choisie (à temps = fait au plus tard le jour de l’échéance).'), tiles = el('div', 'stats');
      tiles.appendChild(statTile('À faire', todo.length, true));
      tiles.appendChild(statTile('En retard', late.length));
      tiles.appendChild(statTile('À rendre cette semaine', week.length));
      tiles.appendChild(statTile('Prochains contrôles', ctrl.length + (ctrl.length ? ' · ' + dfmt(ctrl[0].due, fm) : '')));
      tiles.appendChild(statTile('Faits sur la période', done.length));
      tiles.appendChild(statTile('Faits à temps', timed.length ? Math.round(onTime.length / timed.length * 100) + ' % (' + onTime.length + ' / ' + timed.length + ')' : '—'));
      s1.appendChild(tiles); out.appendChild(s1);

      var s2 = section('Prochaines échéances'), next = todo.filter(function(x){ return x.due; }).sort(byDue).slice(0, 10);
      if(!next.length) s2.appendChild(el('p', 'hint empty', todo.length ? 'Aucun devoir à faire n’a de date d’échéance.' : 'Rien à faire : tout est à jour.'));
      else s2.appendChild(tbl(['Échéance', 'Matière', 'Travail', 'Type'], next.map(function(x){
        var n = dd(td, x.due);
        return [dfmt(x.due, fm) + ' · ' + (n < 0 ? 'en retard' : (n === 0 ? 'aujourd’hui' : (n === 1 ? 'demain' : 'dans ' + n + ' j'))), nameOf(subs, x.subj, '—'), x.desc || '—', nameOf(kinds, x.kind, '—')];
      })));
      out.appendChild(s2);

      function split(title, list, key, none){   // répartition : à faire (état actuel) + faits (période)
        var known = function(x){ return list.some(function(o){ return o.id === x[key]; }); }, max = 1;
        var items = list.concat(rows.some(function(x){ return !known(x); }) ? [{id: null, name: none, color: '#8a8f98'}] : []);
        var dt = items.map(function(o){
          var f = function(x){ return o.id === null ? !known(x) : x[key] === o.id; }, a = todo.filter(f).length, b = done.filter(f).length;
          if(a + b > max) max = a + b; return {o: o, a: a, b: b};
        }).filter(function(d){ return d.a + d.b > 0; });
        var s = section(title, 'À faire : état actuel. Faits : sur la période choisie.');
        if(!dt.length) s.appendChild(el('p', 'hint empty', 'Rien à afficher pour ces filtres.'));
        else s.appendChild(hbList(dt.map(function(d){ return {name: d.o.name, pct: (d.a + d.b) / max * 100, color: d.o.color, txt: d.a + ' à faire · ' + d.b + ' fait' + (d.b > 1 ? 's' : '')}; })));
        return s;
      }
      out.appendChild(split('Par matière', subs, 'subj', 'Sans matière'));
      out.appendChild(split('Par type', kinds, 'kind', 'Sans type'));

      var ul = ['En retard'], us = ['Retard'], uv = [late.length], uc = ['var(--warn)'], i, b, e;
      for(i = 0; i < 8; i++){
        b = addDays(mon, i * 7); e = addDays(b, 6);
        ul.push('Semaine du ' + dfmt(b, fm)); us.push(dfmt(b, {day: 'numeric', month: 'numeric'})); uc.push('var(--accent)');
        uv.push(todo.filter(function(x){ return x.due && x.due >= b && x.due <= e && x.due >= td; }).length);
      }
      var s3 = section('Charge à venir', 'Devoirs à faire par semaine d’échéance (8 prochaines semaines), plus ceux déjà en retard.'), l3 = el('div', 'legend');
      s3.appendChild(chartBox(barChart({labels: ul, short: us, vals: uv, colors: uc, max: Math.max(1, Math.max.apply(null, uv)), aria: 'Charge de devoirs à venir par semaine'})));
      l3.appendChild(lg('k-bar', 'var(--warn)', 'En retard')); l3.appendChild(lg('k-bar', 'var(--accent)', 'À rendre dans la semaine')); s3.appendChild(l3);
      s3.appendChild(altTable(['Semaine', 'Devoirs à faire'], ul.map(function(x, j){ return [x, uv[j]]; })));
      out.appendChild(s3);

      var s4 = section('Évolution hebdomadaire', 'Devoirs faits chaque semaine de la période, dont ceux faits à temps.');
      if(hi >= F){
        var bk = [], k = mondayOfKey(F), g = 0;
        while(k <= hi && g++ < 600){ bk.push(k); k = addDays(k, 7); }
        var wl = bk.map(function(x){ return 'sem. du ' + dfmt(x, fm); });
        var cnt = function(list){ return bk.map(function(x){ var y = addDays(x, 6); return list.filter(function(d){ return d.at >= x && d.at <= y; }).length; }); };
        var vf = cnt(done), vt = cnt(onTime), l4 = el('div', 'legend');
        s4.appendChild(chartBox(lineChart({labels: wl, series: [{name: 'Faits à temps', color: 'var(--ok)', vals: vt}, {name: 'Faits', color: 'var(--accent)', vals: vf, main: true}], max: Math.max(1, Math.max.apply(null, vf.concat([1]))), aria: 'Devoirs faits et faits à temps par semaine'})));
        l4.appendChild(lg('k-main', '', 'Faits')); l4.appendChild(lg('k-line', 'var(--ok)', 'Faits à temps')); s4.appendChild(l4);
        s4.appendChild(altTable(['Semaine', 'Faits', 'Faits à temps'], bk.map(function(x, j){ return [wl[j], vf[j], vt[j]]; })));
      }else s4.appendChild(el('p', 'hint empty', 'La période choisie est entièrement à venir.'));
      out.appendChild(s4);
    }
    draw();
  }

  function renderDash(kind){
    var host = $('dash-' + kind); if(!host) return;
    if(msOpen) msOpen.close();
    host.innerHTML = '';
    if(kind === 'devoirs') dashDevoirs(host); else dashGoals(kind, host);
  }
  function refreshDash(){ ['sport', 'menage', 'devoirs'].forEach(function(k){ var d = $('dash-' + k); if(d && !$('tab-dash').hidden && !d.hidden) renderDash(k); }); }

  /* ---- Cartes par défaut : Sport, Ménage, Devoirs (créées une seule fois, jamais recréées après suppression) ---- */
  function ensureDefaults(){
    var flags = isObj(data.defaultCards) ? data.defaultCards : {}, changed = false, dv;
    DEFAULT_CARDS.forEach(function(def){
      if(flags[def.type]) return;
      if(!data.cards.some(function(c){ return c.type === def.type; })){
        data.cards.push({id: uid(), type: def.type, title: def.title, icon: def.icon, color: def.color, createdAt: now(), updatedAt: now(), order: nextOrder(data.cards), items: [],
          goals: def.lines.map(function(l, i){ return newLine(l[0], {every: 1, unit: l[1]}, l[2], l[3], l[4], i); })});
      }
      flags[def.type] = true; changed = true;
    });
    if(!flags.devoirs){
      if(!data.cards.some(function(c){ return isDevoirs(c); })){
        dv = newDevoirs(nextOrder(data.cards));
        if(!Array.isArray(dv.items)) dv.items = []; if(!Array.isArray(dv.goals)) dv.goals = [];
        if(!Array.isArray(dv.columns)) dv.columns = []; if(!Array.isArray(dv.rows)) dv.rows = [];
        data.cards.push(dv);
      }
      flags.devoirs = true; changed = true;
    }
    if(!changed) return false;
    data.defaultCards = flags;
    save(); render(); refreshDash();
    return true;
  }
  var shownDay = dkey(new Date());
  function dayCheck(){ var d = dkey(new Date()); if(d === shownDay) return; shownDay = d; render(); refreshDash(); }   // changement de jour : périodes et pastilles recalculées
  setInterval(dayCheck, 60000);
  document.addEventListener('visibilitychange', dayCheck);
  window.Checklists = {render: render, renderDash: renderDash, ensureDefaults: ensureDefaults};
  render();
};
})();
