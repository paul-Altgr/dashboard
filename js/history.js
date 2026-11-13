/* ==========================================================================
   Historique, Dashboard Heures et onglets.
   - Store : lecture/écriture JSON dans le cache localStorage de l'utilisateur (la synchro Supabase est gérée dans le dernier script).
   - PlanApp.registerWidget(w) : ajoute un widget au Dashboard Heures
     ({id, title, render(ctx) -> HTML}) ; ctx = {rows, groups, filters}.
   - Le Dashboard comporte quatre sous-sections : #dash/heures (ici), #dash/sport, #dash/menage et #dash/devoirs (script Checklists).
   - Nouvelles données : ajouter une clé dans window.CloudSync.keys et l'inclure dans snapshot(), validChk()/valid() et applyData().
   ========================================================================== */
window.bootHistory = function(){
  'use strict';
  var P = window.Planning, $ = function(id){ return document.getElementById(id); };
  var HKEY = window.CloudSync.keys.hist, SCHOOL = 35 * 60, COMPANY = 39 * 60;
  var pad = function(n){ return (n < 10 ? '0' : '') + n; };
  var fmt = P.fmt;

  var Store = {
    read: function(k, d){ try{ var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; }catch(e){ return d; } },
    write: function(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
  };
  var weeks = Store.read(HKEY, {});   // { 'YYYY-MM-DD' (lundi) : {type, goal, done} } — durées en minutes

  /* ---- Dates ---- */
  function parseD(s){ var p = s.split('-'); return new Date(+p[0], +p[1]-1, +p[2]); }
  function ymd(d){ return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function mondayOf(s){ var d = parseD(s); d.setDate(d.getDate() - ((d.getDay()+6)%7)); return ymd(d); }
  function isoInfo(s){                       // n° de semaine ISO (jeudi de la semaine)
    var d = parseD(s); d.setDate(d.getDate() + 3);
    var j = new Date(d.getFullYear(), 0, 4);
    return {week: 1 + Math.round(((d - j) / 864e5 - 3 + ((j.getDay()+6)%7)) / 7), year: d.getFullYear()};
  }
  function dayLabel(id){ return 'lundi ' + parseD(id).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}); }
  function sgn(m){ return (m < 0 ? '−' : '+') + fmt(Math.abs(m)); }
  function rowsAll(){
    return Object.keys(weeks).sort().map(function(k){
      var i = isoInfo(k), w = weeks[k];
      return {id:k, week:i.week, year:i.year, type:w.type, goal:w.goal, done:w.done};
    });
  }
  function currentId(){ return mondayOf(P.snapshot().id); }

  /* ---- Synchronisation de la semaine en cours ---- */
  function sync(){
    var s = P.snapshot();
    weeks[mondayOf(s.id)] = {type: s.school ? 'ecole' : 'entreprise', goal: s.goal, done: s.done};
    Store.write(HKEY, weeks);
    if(!$('tab-histo').hidden) renderHisto();
    if(!$('tab-dash').hidden && !$('dash-heures').hidden) renderDash();
  }
  document.addEventListener('planning:change', sync);

  /* ---- Historique ---- */
  function renderHisto(){
    var cur = currentId(), all = rowsAll().reverse();
    $('hBody').innerHTML = all.length ? all.map(function(r){
      var c = r.id === cur, gap = r.done - r.goal;
      return '<tr><td>S' + r.week + ' · ' + r.year + '<span class="cap">' + dayLabel(r.id) + '</span></td>' +
        '<td><span class="tag ' + r.type + '">' + (r.type === 'ecole' ? 'École' : 'Entreprise') + '</span>' + (c ? ' <span class="badge">En cours</span>' : '') + '</td>' +
        '<td class="num">' + fmt(r.goal) + '</td><td class="num">' + fmt(r.done) + '</td>' +
        '<td class="num ' + (gap >= 0 ? 'pos' : 'neg') + '">' + sgn(gap) + '</td>' +
        '<td class="act"><button type="button" class="ib" title="Modifier" aria-label="Modifier la semaine" data-lbl="Modifier" data-edit="' + r.id + '"' + (c ? ' disabled' : '') + '>✏️</button> ' +
        '<button type="button" class="ib" title="Supprimer" aria-label="Supprimer la semaine" data-lbl="Supprimer" data-del="' + r.id + '"' + (c ? ' disabled' : '') + '>🗑️</button></td></tr>';
    }).join('') : '<tr><td colspan="6">Aucune semaine enregistrée.</td></tr>';
  }

  var dlg = $('wDialog'), editing = null;
  var hmG = P.makeHM('Objectif', function(){}, function(){});
  var hmD = P.makeHM('Effectué', function(){}, function(){});
  $('wGoalBox').appendChild(hmG.el); $('wDoneBox').appendChild(hmD.el);
  function lockSchool(){
    var s = $('wSchool').checked;
    if(s){ hmG.set(SCHOOL); hmD.set(SCHOOL); }
    hmG.setDisabled(s); hmD.setDisabled(s);
  }
  $('wSchool').addEventListener('change', lockSchool);
  function openDlg(id){
    editing = id;
    var w = id ? weeks[id] : {type:'entreprise', goal:COMPANY, done:0};
    $('wTitle').textContent = id ? 'Modifier la semaine' : 'Ajouter une semaine';
    $('wDate').value = id || mondayOf(ymd(new Date())); $('wDate').disabled = !!id;
    $('wSchool').checked = w.type === 'ecole';
    hmG.set(w.goal); hmD.set(w.done); lockSchool();
    $('wErr').textContent = '';
    dlg.showModal();
  }
  $('hAdd').addEventListener('click', function(){ openDlg(null); });
  $('wCancel').addEventListener('click', function(){ dlg.close(); });
  $('wSave').addEventListener('click', function(){
    if(!$('wDate').value){ $('wErr').textContent = 'Choisis une date.'; return; }
    var id = mondayOf($('wDate').value);
    if(id === currentId()){ $('wErr').textContent = 'La semaine en cours se gère dans l’onglet Semaine.'; return; }
    if(!editing && weeks[id] && !confirm('Cette semaine existe déjà. La remplacer ?')) return;
    var sch = $('wSchool').checked;
    weeks[id] = {type: sch ? 'ecole' : 'entreprise', goal: sch ? SCHOOL : hmG.get(), done: sch ? SCHOOL : hmD.get()};
    Store.write(HKEY, weeks); dlg.close(); renderHisto();
  });
  $('hBody').addEventListener('click', function(e){
    var b = e.target.closest('button'); if(!b) return;
    if(b.dataset.edit) openDlg(b.dataset.edit);
    if(b.dataset.del && confirm('Supprimer cette semaine de l’historique ?')){
      delete weeks[b.dataset.del]; Store.write(HKEY, weeks); renderHisto();
    }
  });

  /* ---- Dashboard Heures ---- */
  var F = {year:'all', type:'all', group:'week', sort:'recent'};
  var widgets = [];

  function groupRows(rows){
    var g = {}, out = [];
    rows.forEach(function(r){
      var k = F.group === 'month' ? r.id.slice(0,7) : r.id;
      if(!g[k]){
        g[k] = {key:k, n:0, done:0, goal:0, ok:0, ecole:0,
          label: F.group === 'month' ? parseD(k + '-01').toLocaleDateString('fr-FR',{month:'short',year:'2-digit'}) : 'S' + r.week + ' ' + String(r.year).slice(2)};
        out.push(g[k]);
      }
      var x = g[k]; x.n++; x.done += r.done; x.goal += r.goal; if(r.done >= r.goal) x.ok++; if(r.type === 'ecole') x.ecole++;
    });
    return out;
  }
  function slope(rows){                       // tendance : régression linéaire (min / semaine)
    var y = rows.slice(-8).map(function(r){ return r.done; }), n = y.length;
    if(n < 3) return null;
    var mx = (n-1)/2, my = y.reduce(function(a,b){ return a+b; }, 0) / n, num = 0, den = 0;
    y.forEach(function(v,i){ num += (i-mx)*(v-my); den += (i-mx)*(i-mx); });
    return num / den;
  }
  function tile(l, v){ return '<div class="stat"><span>' + l + '</span><strong>' + v + '</strong></div>'; }

  function infoIcon(t){
    return '<span class="info" tabindex="0" role="button" aria-label="Aide" data-tip="' + t.replace(/&/g,'&amp;').replace(/"/g,'&quot;') + '">i</span>';
  }
  /* Légende : k = dot (répartition) | bar (série) | line (objectif) | ghost (objectif de la semaine en cours) */
  function legend(items){
    return '<div class="legend">' + items.map(function(i){ return '<span class="lg"><i class="k-' + i.k + '" style="--c:' + i.c + '"></i>' + i.t + '</span>'; }).join('') + '</div>';
  }
  function curRow(c){
    var r = c.current; if(!r) return '';
    return '<tr class="today"><td>S' + r.week + ' <span class="badge">Semaine en cours</span></td><td class="num">1</td><td class="num">' + fmt(r.done) + '</td><td class="num">' + fmt(r.done) + '</td><td class="num">' + sgn(r.done - r.goal) + '</td><td class="num">—</td></tr>';
  }
  function chartSvg(gs, cur){
    gs = gs.slice();
    if(cur) gs.push({key:'~', label:'En cours', n:1, done:cur.done, goal:cur.goal, ecole:cur.type === 'ecole' ? 1 : 0, current:true});
    if(!gs.length) return '<p class="hint">Aucune donnée.</p>';
    var W = Math.max(640, gs.length * 26), H = 240, pl = 38, pb = 28, pt = 10, n = gs.length, bw = (W - pl - 8) / n;
    var avg = function(g){ return g.done / g.n; }, goalAvg = function(g){ return g.goal / g.n; };
    var max = Math.max.apply(null, gs.map(avg).concat(gs.map(goalAvg))) * 1.12 || 1;
    var y = function(v){ return pt + (H - pt - pb) * (1 - v / max); };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;min-width:' + Math.min(W, 640) + 'px;height:auto" role="img" aria-label="Heures par période">';
    for(var t = 0; t <= 4; t++){
      var v = max * t / 4;
      svg += '<line x1="' + pl + '" x2="' + W + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)"/><text x="' + (pl-6) + '" y="' + (y(v)+4) + '" text-anchor="end" font-size="11" fill="var(--muted)">' + Math.round(v/60) + ' h</text>';
    }
    var pts = [], step = Math.ceil(n / 14);
    gs.forEach(function(g, i){
      var x = pl + i * bw, cx = x + bw / 2;
      var col = g.ecole === g.n ? '#6b7fd6' : 'var(--accent)', bx = x + bw*.15, bwid = bw*.7;
      if(g.current) svg += '<rect x="' + bx + '" y="' + y(goalAvg(g)) + '" width="' + bwid + '" height="' + (H - pb - y(goalAvg(g))) + '" rx="3" fill="' + col + '" fill-opacity=".25" stroke="' + col + '" stroke-dasharray="4 3"><title>Objectif ' + fmt(goalAvg(g)) + '</title></rect>';
      svg += '<rect x="' + bx + '" y="' + y(avg(g)) + '" width="' + bwid + '" height="' + (H - pb - y(avg(g))) + '" rx="3" fill="' + col + '"><title>' + g.label + ' : ' + fmt(avg(g)) + '</title></rect>';
      pts.push(cx + ',' + y(goalAvg(g)));
      if(i % step === 0 || g.current) svg += '<text x="' + cx + '" y="' + (H-10) + '" text-anchor="middle" font-size="11" fill="var(--muted)">' + g.label + '</text>';
    });
    return '<div class="chart">' + svg + '<polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--warn)" stroke-width="2" stroke-dasharray="5 4"/></svg></div>' +
      legend([{k:'bar',c:'var(--accent)',t:'Entreprise'},{k:'bar',c:'#6b7fd6',t:'École'},{k:'line',c:'var(--warn)',t:'Objectif'}].concat(cur ? [{k:'ghost',c:'var(--accent)',t:'Semaine en cours : objectif (barre pleine = réalisé)'}] : []));
  }

  widgets.push({id:'kpis', title:'Indicateurs clés', tip:'Calculé sur les semaines terminées uniquement (hors semaine en cours).', render:function(c){
    var r = c.rows, n = r.length;
    if(!n) return '<p class="hint">Aucune donnée pour ces filtres.</p>';
    var tot = 0, goal = 0, ok = 0;
    r.forEach(function(x){ tot += x.done; goal += x.goal; if(x.done >= x.goal) ok++; });
    var sl = slope(r), tr = sl === null ? '—' : (Math.abs(sl) < 5 ? '→ stable' : (sl > 0 ? '↗ +' : '↘ −') + Math.round(Math.abs(sl)) + ' min/sem');
    return '<div class="stats">' + tile('Semaines', n) + tile('Total effectué', fmt(tot)) + tile('Moyenne / semaine', fmt(tot / n)) +
      tile('Respect de l’objectif', Math.round(ok / n * 100) + ' %') + tile('Semaines incomplètes', n - ok) +
      tile('Écart cumulé', '<span class="' + (tot >= goal ? 'pos' : 'neg') + '">' + sgn(tot - goal) + '</span>') + tile('Tendance (8 sem.)', tr) + '</div>';
  }});
  widgets.push({id:'chart', title:'Évolution des heures', tip:'La semaine en cours est affichée avec son objectif (barre translucide) et ses heures réalisées (barre pleine), sans entrer dans les statistiques.', render:function(c){ return chartSvg(c.groups, c.current); }});
  widgets.push({id:'split', title:'Répartition entreprise / école', tip:'Répartition des semaines terminées (hors semaine en cours).', render:function(c){
    var e = c.rows.filter(function(x){ return x.type === 'ecole'; }).length, t = c.rows.length, f = t - e;
    if(!t) return '<p class="hint">Aucune donnée.</p>';
    return '<div class="split"><i style="width:' + f/t*100 + '%;background:var(--accent)"></i><i style="width:' + e/t*100 + '%;background:#6b7fd6"></i></div>' +
      legend([{k:'dot',c:'var(--accent)',t:'Entreprise : ' + f + ' sem. (' + Math.round(f/t*100) + ' %)'},{k:'dot',c:'#6b7fd6',t:'École : ' + e + ' sem. (' + Math.round(e/t*100) + ' %)'}]);
  }});
  widgets.push({id:'table', title:'Détail par période', tip:'Moyennes et écarts calculés sur les semaines terminées ; la semaine en cours est affichée à titre indicatif.', render:function(c){
    var g = c.groups.slice();
    var sorts = {recent:function(a,b){ return a.key < b.key ? 1 : -1; }, old:function(a,b){ return a.key > b.key ? 1 : -1; },
      done:function(a,b){ return b.done/b.n - a.done/a.n; }, gap:function(a,b){ return (a.done-a.goal) - (b.done-b.goal); }};
    g.sort(sorts[F.sort]);
    return '<div class="tablewrap"><table><thead><tr><th>Période</th><th class="num">Sem.</th><th class="num">Total</th><th class="num">Moy.</th><th class="num">Écart</th><th class="num">Respect</th></tr></thead><tbody>' + curRow(c) +
      g.map(function(x){ var gap = x.done - x.goal; return '<tr><td>' + x.label + '</td><td class="num">' + x.n + '</td><td class="num">' + fmt(x.done) + '</td><td class="num">' + fmt(x.done/x.n) + '</td><td class="num ' + (gap >= 0 ? 'pos' : 'neg') + '">' + sgn(gap) + '</td><td class="num">' + Math.round(x.ok/x.n*100) + ' %</td></tr>'; }).join('') +
      '</tbody></table></div>';
  }});

  function renderDash(){
    var all = rowsAll(), years = [];
    all.forEach(function(r){ if(years.indexOf(r.year) < 0) years.push(r.year); });
    $('fYear').innerHTML = '<option value="all">Toutes</option>' + years.map(function(y){ return '<option value="' + y + '">' + y + '</option>'; }).join('');
    $('fYear').value = years.indexOf(+F.year) >= 0 ? F.year : (F.year = 'all');
    /* Semaine en cours : affichée (graphique, tableau) mais exclue de toutes les statistiques */
    var cur = currentId();
    var flt = function(r){ return (F.year === 'all' || String(r.year) === F.year) && (F.type === 'all' || r.type === F.type); };
    var rows = all.filter(function(r){ return r.id !== cur && flt(r); });
    var running = all.filter(function(r){ return r.id === cur && flt(r); })[0] || null;
    var ctx = {rows:rows, groups:groupRows(rows), current:running, filters:F};
    $('dashWidgets').innerHTML = widgets.map(function(w){ return '<section class="card" data-widget="' + w.id + '"><h2>' + w.title + (w.tip ? infoIcon(w.tip) : '') + '</h2>' + w.render(ctx) + '</section>'; }).join('');
  }
  [['fYear','year'],['fType','type'],['fGroup','group'],['fSort','sort']].forEach(function(p){
    $(p[0]).addEventListener('change', function(){ F[p[1]] = this.value; renderDash(); });
  });

  /* ---- Onglets (routage par #hash : semaine, histo, dash/heures, dash/sport, dash/menage, dash/devoirs, checklists) ---- */
  var TABS = ['semaine','histo','dash','checklists'], SUBS = ['heures','sport','menage','devoirs'], lastSub = 'heures';
  function show(h){
    var parts = String(h).split('/'), t = parts[0];
    if(TABS.indexOf(t) < 0) t = 'semaine';
    TABS.forEach(function(x){ $('tab-' + x).hidden = (x !== t); });
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function(b){ b.classList.toggle('on', b.dataset.tab === t); });
    if(t === 'histo') renderHisto();
    if(t === 'dash') showSub(parts[1]);
    if(t === 'checklists' && window.Checklists) window.Checklists.render();
  }
  function showSub(s){   // sous-sections du Dashboard ; « #dash » seul rouvre la dernière sous-section consultée
    if(SUBS.indexOf(s) < 0) s = lastSub;
    lastSub = s;
    SUBS.forEach(function(x){ $('dash-' + x).hidden = (x !== s); });
    Array.prototype.forEach.call(document.querySelectorAll('.subtabs button'), function(b){
      var on = b.dataset.sub === s; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if(s === 'heures') renderDash(); else window.Checklists.renderDash(s);
  }
  function go(h){ if(location.hash.slice(1) === h) show(h); else location.hash = h; }   // un seul rendu par navigation
  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function(b){
    b.addEventListener('click', function(){ go(b.dataset.tab === 'dash' ? 'dash/' + lastSub : b.dataset.tab); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.subtabs button'), function(b){
    b.addEventListener('click', function(){ go('dash/' + b.dataset.sub); });
  });
  window.addEventListener('hashchange', function(){ show(location.hash.slice(1)); });

  /* Infobulles : un seul élément flottant ; survol (souris), toucher/clic (mobile), clavier */
  var tipEl = $('tip'), tipFor = null, pinned = false;
  function showTip(el){
    tipEl.textContent = el.dataset.tip || '';
    if(!tipEl.textContent){ hideTip(); return; }
    tipEl.hidden = false; tipFor = el;
    var r = el.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    var x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    var y = r.bottom + 8; if(y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 8);
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  }
  function hideTip(){ tipEl.hidden = true; tipFor = null; pinned = false; }
  function infoOf(e){ return e.target.closest ? e.target.closest('.info') : null; }
  document.addEventListener('pointerover', function(e){ var el = infoOf(e); if(el && e.pointerType === 'mouse' && !pinned) showTip(el); });
  document.addEventListener('pointerout', function(e){ var el = infoOf(e); if(el && e.pointerType === 'mouse' && !pinned) hideTip(); });
  document.addEventListener('click', function(e){
    var el = infoOf(e);
    if(!el){ hideTip(); return; }
    e.preventDefault();
    if(tipFor === el && pinned) hideTip(); else { showTip(el); pinned = true; }
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape') hideTip();
    if((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('info')){ e.preventDefault(); e.target.click(); }
  });
  window.addEventListener('scroll', hideTip, true);

  window.PlanApp = {store: Store, registerWidget: function(w){ widgets.push(w); if(!$('tab-dash').hidden) renderDash(); }};
  sync();
  show(location.hash.slice(1));
};