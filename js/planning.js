/* Démarré par la couche Supabase une fois l'utilisateur authentifié */
window.bootPlanning = function(){
  var GOAL = 39 * 60, DAY = 39 * 60 / 5, KEY = window.CloudSync.keys.plan;   // cache local propre à l'utilisateur
  var DAYS = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
  var $ = function(id){ return document.getElementById(id); };

  function pad(n){ return (n < 10 ? '0' : '') + n; }
  function fmt(min){
    min = Math.round(min);
    return Math.floor(min / 60) + ' h ' + pad(min % 60);
  }
  function hoursOf(t, fallback){
    var m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
    return m ? (+m[1] + m[2] / 60) : fallback;
  }
  function dayStr(){
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate();
  }
  function weekKey(){
    var d = new Date(); d.setHours(0,0,0,0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate();
  }
  function autoMoment(){
    var d = new Date(), h = d.getHours() + d.getMinutes() / 60;
    return h < 12 ? 'matin' : (h < 17.5 ? 'midi' : 'soir');
  }
  function fresh(){
    return {week:weekKey(), done:0, locks:{}, off:{}, school:false, mode:'auto', moment:autoMoment(), momentDay:dayStr(),
            cfg:{start:'08:00', pause:60, resume:'13:00', end:'18:00'}};
  }
  function load(){
    var s = null, b = fresh();
    try{ s = JSON.parse(localStorage.getItem(KEY)); }catch(e){}
    if(s && s.cfg) b.cfg = Object.assign(b.cfg, s.cfg);
    if(s && s.week === b.week && s.locks){
      b.done = s.done || 0; b.locks = s.locks; b.off = s.off || {}; b.school = !!s.school; b.mode = s.mode || 'auto';
      if(s.momentDay === dayStr() && s.moment) b.moment = s.moment;
    }
    return b;
  }
  function save(){
    try{ localStorage.setItem(KEY, JSON.stringify(st)); }catch(e){}
  }

  /* Saisie heures + minutes */
  function makeHM(label, onInput, onLeave){
    var el = document.createElement('span'); el.className = 'hm';
    function mk(max, aria){
      var i = document.createElement('input');
      i.type = 'number'; i.min = '0'; i.max = max; i.step = '1'; i.inputMode = 'numeric';
      i.setAttribute('aria-label', label + ' ' + aria);
      return i;
    }
    function unit(t){ var s = document.createElement('span'); s.textContent = t; return s; }
    var h = mk('99', '(heures)'), m = mk('59', '(minutes)');
    el.appendChild(h); el.appendChild(unit('h')); el.appendChild(m); el.appendChild(unit('min'));
    function n(i){ return Math.max(0, Math.round(parseFloat(i.value) || 0)); }
    var api = {
      el: el,
      get: function(){ return n(h) * 60 + n(m); },
      set: function(t){ h.value = Math.floor(t / 60); m.value = pad(t % 60); },
      focused: function(){ return el.contains(document.activeElement); },
      setDisabled: function(d){ h.disabled = d; m.disabled = d; }
    };
    el.addEventListener('input', function(){ onInput(api.get()); });
    el.addEventListener('focusout', function(e){ if(!el.contains(e.relatedTarget)) onLeave(); });
    return api;
  }

  var st = load();
  var builtSig = '';
  var rowRefs = {};

  function isWeekend(){ var g = new Date().getDay(); return g === 0 || g === 6; }
  function todayIdx(){
    if(st.mode !== 'auto') return +st.mode;
    var g = new Date().getDay();
    // 0=dimanche, 1=lundi... 6=samedi
    if(g === 0) return 6; // Dimanche -> index 6 (Dimanche)
    if(g === 6) return 5; // Samedi -> index 5 (Samedi)
    return g - 1; // Lundi=0...Vendredi=4
  }
  function startIdx(){ return todayIdx() + (st.moment === 'soir' ? 1 : 0); }
  function remainingDays(){
    var out = [];
    for(var i = startIdx(); i <= 4; i++) out.push(i);
    return out;
  }
  function fixed(i){ return st.off[i] ? DAY : st.locks[i]; }
  function capToday(){
    var s = hoursOf(st.cfg.start, 8), e = hoursOf(st.cfg.end, 18), r = hoursOf(st.cfg.resume, 13);
    if(st.moment === 'matin') return Math.max(0, Math.round((e - s) * 60) - (st.cfg.pause || 0));
    if(st.moment === 'midi') return Math.max(0, Math.round((e - r) * 60));
    return Infinity;
  }
  function spread(list, amount, values){
    if(!list.length) return;
    var base = Math.floor(amount / list.length), extra = amount % list.length;
    list.forEach(function(i, k){ values[i] = base + (k < extra ? 1 : 0); });
  }

  function compute(){
    var days = remainingDays();
    var eff = st.done;   // les heures saisies incluent déjà les jours fériés/RTT passés
    var remaining = Math.max(0, GOAL - eff);
    var lockedSum = 0, free = [];
    days.forEach(function(i){
      if(fixed(i) !== undefined) lockedSum += fixed(i); else free.push(i);
    });
    var pool = Math.max(0, remaining - lockedSum);
    var t = todayIdx(), cap = capToday();
    var values = {}, capped = false;

    if(free.length && st.moment !== 'soir' && free.indexOf(t) !== -1 && pool / free.length > cap){
      capped = true;
      values[t] = cap;
      spread(free.filter(function(i){ return i !== t; }), pool - cap, values);
    }else{
      spread(free, pool, values);
    }
    var planned = 0;
    days.forEach(function(i){
      if(fixed(i) !== undefined) values[i] = fixed(i);
      planned += values[i];
    });
    return {eff:eff, days:days, remaining:remaining, values:values, planned:planned, free:free,
            lockedSum:lockedSum, cap:cap, capped:capped, t:t};
  }

  function slotLabel(){
    if(st.moment === 'matin') return 'Max ' + fmt(capToday()) + ' (' + st.cfg.start + '–' + st.cfg.end + ', pause ' + fmt(st.cfg.pause || 0) + ')';
    if(st.moment === 'midi') return 'Max ' + fmt(capToday()) + ' (' + st.cfg.resume + '–' + st.cfg.end + ')';
    return '';
  }

  function buildRows(){
    var days = remainingDays(), t = todayIdx();
    builtSig = startIdx() + '|' + st.moment;
    rowRefs = {};
    var tb = $('rows'); tb.innerHTML = '';
    if(!days.length){
      var e = document.createElement('tr'), c = document.createElement('td');
      c.colSpan = 3; c.textContent = 'Aucun jour restant cette semaine.';
      e.appendChild(c); tb.appendChild(e);
      return;
    }
    days.forEach(function(i, k){
      var tr = document.createElement('tr');
      var isToday = (i === t);
      if(isToday) tr.className = 'today';

      var td1 = document.createElement('td');
      td1.appendChild(document.createTextNode(DAYS[i]));
      if(isToday || k === 0){
        var b = document.createElement('span');
        b.className = 'badge'; b.textContent = isToday ? 'Aujourd’hui' : 'Demain';
        td1.appendChild(b);
      }
      var cap = document.createElement('span'); cap.className = 'cap';
      td1.appendChild(cap);

      var td2 = document.createElement('td'); td2.className = 'num';
      var cb = document.createElement('input'); cb.type = 'checkbox';
      var hm = makeHM(DAYS[i], function(v){
        st.locks[i] = v; cb.checked = true; update();
      }, update);
      td2.appendChild(hm.el);

      var td3 = document.createElement('td');
      var lab = document.createElement('label'); lab.className = 'lock';
      var sp = document.createElement('span'); sp.textContent = 'Bloqué 🔒';
      lab.appendChild(cb); lab.appendChild(sp); td3.appendChild(lab);

      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
      tb.appendChild(tr);
      rowRefs[i] = {tr:tr, hm:hm, cb:cb, cap:cap};

      cb.addEventListener('change', function(){
        if(cb.checked) st.locks[i] = compute().values[i];
        else delete st.locks[i];
        update();
      });
    });
  }

  /* Carte du jour : compte à rebours, progression et horloge (mise à jour chaque seconde) */
  var live = null;   // {T (min à faire), mode, startH, pauseH, resumeH} ou null si carte masquée
  function rot(id, deg){ $(id).setAttribute('transform', 'rotate(' + deg.toFixed(2) + ' 60 60)'); }
  function tick(){
    var now = new Date(), nh = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    rot('hHand', (nh % 12) * 30); rot('mHand', (now.getMinutes() + now.getSeconds() / 60) * 6); rot('sHand', now.getSeconds() * 6);
    if(!live) return;
    /* Temps déjà travaillé : depuis l'arrivée (avant la pause) ou depuis la reprise (après) */
    var w = live.mode === 'matin'
      ? Math.max(0, nh - live.startH - (nh >= live.resumeH ? live.pauseH : 0))
      : Math.max(0, nh - live.resumeH);
    var th = live.T / 60, sec = Math.round(Math.max(0, th - w) * 3600);
    $('depLeft').textContent = pad(Math.floor(sec / 3600)) + ':' + pad(Math.floor(sec % 3600 / 60)) + ':' + pad(sec % 60);
    var pr = th > 0 ? Math.min(1, w / th) : 0;
    $('dBar').style.width = (pr * 100) + '%';
    $('dPct').textContent = Math.round(pr * 100) + ' %';
    $('dTxt').textContent = fmt(Math.min(th, w) * 60) + ' sur ' + fmt(live.T);
  }

  /* Pont vers les onglets Historique / Dashboard (couplage faible par événement) */
  function notify(){ document.dispatchEvent(new Event('planning:change')); }
  function clock(h){ var m = Math.round(h * 60); return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60); }
  var hmDone = makeHM('Heures réalisées', function(v){ st.done = v; update(); }, update);
  var hmPause = makeHM('Pause', function(v){ st.cfg.pause = v; update(); }, update);

  function update(){
    /* Semaine école : 35 h comptées, aucune saisie */
    document.body.classList.toggle('school', !!st.school);
    $('schoolCb').checked = !!st.school;
    if(st.school){
      var G = 35 * 60;
      $('sGoal').textContent = fmt(G); $('sDone').textContent = fmt(G); $('sLeft').textContent = fmt(0);
      $('sPlan').textContent = fmt(0); $('sTotal').textContent = fmt(G);
      $('barDone').style.width = '100%'; $('barPlan').style.width = '0%';
      $('pctDone').textContent = 'Semaine école'; $('pctTotal').textContent = '35 h comptées';
      $('msg').textContent = 'Semaine école : 35 h comptées automatiquement, aucune saisie nécessaire.';
      $('msg').className = 'msg ok';
      save(); notify(); return;
    }
    $('sGoal').textContent = fmt(GOAL);
    if(builtSig !== startIdx() + '|' + st.moment) buildRows();
    var c = compute();
    var total = c.eff + c.planned;

    if(!hmDone.focused()) hmDone.set(st.done);
    if(!hmPause.focused()) hmPause.set(st.cfg.pause || 0);

    c.days.forEach(function(i){
      var r = rowRefs[i], off = !!st.off[i], locked = fixed(i) !== undefined;
      r.cb.checked = locked; r.cb.disabled = off; r.hm.setDisabled(off);
      r.tr.classList.toggle('locked', locked && !off);
      r.tr.classList.toggle('off', off);
      r.cap.textContent = off ? 'Non travaillé (férié / RTT)' : ((i === c.t && st.moment !== 'soir') ? slotLabel() : '');
      if(!r.hm.focused()) r.hm.set(c.values[i]);
    });

    document.querySelector('input[name=moment][value=' + st.moment + ']').checked = true;
    var hints = {
      matin: 'Journée complète à venir : ' + fmt(capToday()) + ' possibles aujourd’hui.',
      midi: 'Seul l’après-midi reste : ' + fmt(capToday()) + ' possibles aujourd’hui.',
      soir: 'Journée terminée : le calcul commence demain.'
    };
    $('momentInfo').dataset.tip = hints[st.moment];
    $('doneInfo').dataset.tip = {
      matin: 'Total de la semaine avant ta journée',
      midi: 'Total de la semaine, matinée comprise',
      soir: 'Total de la semaine, journée d’aujourd’hui comprise'
    }[st.moment];

    chipRefs.forEach(function(r, i){
      r.cb.checked = !!st.off[i]; r.lab.classList.toggle('on', !!st.off[i]);
    });
    $('offInfo').dataset.tip = 'Férié ou RTT : le jour compte ' + fmt(DAY) + ' (39 h ÷ 5) et se bloque automatiquement. Un jour déjà passé n’est pas recompté : les heures déjà réalisées l’incluent.';

    $('sDone').textContent = fmt(c.eff);
    $('sLeft').textContent = fmt(c.remaining);
    $('sPlan').textContent = fmt(c.planned);
    $('sTotal').textContent = fmt(total);

    var pd = Math.min(100, c.eff / GOAL * 100);
    var pp = Math.min(100 - pd, c.planned / GOAL * 100);
    $('barDone').style.width = pd + '%';
    $('barPlan').style.width = pp + '%';
    $('bar').setAttribute('aria-valuenow', (Math.min(GOAL, c.eff) / 60).toFixed(2));
    $('pctDone').textContent = 'Réalisé : ' + pd.toFixed(0) + ' %';
    $('pctTotal').textContent = 'Prévu : ' + Math.min(100, total / GOAL * 100).toFixed(0) + ' %';

    var text = '', kind = '', short = c.remaining - c.planned;
    if(c.eff > GOAL){
      text = 'Objectif dépassé : ' + fmt(c.eff - GOAL) + ' de plus que 39 h.'; kind = 'ok';
    }else if(c.eff === GOAL){
      text = 'Objectif de 39 h atteint. Bravo !'; kind = 'ok';
    }else if(short > 0){
      kind = 'warn';
      if(!c.days.length) text = 'Plus aucun jour restant : il manque ' + fmt(short) + ' pour atteindre 39 h.';
      else if(c.capped && c.free.length === 1) text = 'Le créneau d’aujourd’hui est plein : il manque ' + fmt(short) + ' pour atteindre 39 h.';
      else text = 'Il manque ' + fmt(short) + ' pour atteindre 39 h. Débloquez un jour pour les répartir.';
    }else if(c.lockedSum > c.remaining){
      text = 'Les jours bloqués dépassent le reste à faire de ' + fmt(c.lockedSum - c.remaining) + '. Le total prévu est de ' + fmt(total) + '.'; kind = 'warn';
    }else if(st.moment !== 'soir' && !st.off[c.t] && fixed(c.t) !== undefined && fixed(c.t) > c.cap){
      text = 'Aujourd’hui dépasse le créneau disponible (' + fmt(c.cap) + ').'; kind = 'warn';
    }
    $('msg').textContent = text;
    $('msg').className = 'msg' + (kind ? ' ' + kind : '');

    var allLocked = c.days.every(function(i){ return fixed(i) !== undefined; });
    $('lockAll').textContent = allLocked ? 'Tout déverrouiller' : 'Tout verrouiller';
    /* Carte « Départ estimé » : uniquement pour le jour courant */
    var dc = $('departCard');
    var show = st.moment !== 'soir' && c.days[0] === c.t && !st.off[c.t] && !(st.mode === 'auto' && isWeekend());
    dc.hidden = !show;
    if(show){
      var left = c.values[c.t], pauseH = (st.cfg.pause || 0) / 60;
      var base = st.moment === 'matin' ? hoursOf(st.cfg.start, 8) + pauseH : hoursOf(st.cfg.resume, 13);
      var dep = base + left / 60;
      live = {T:left, mode:st.moment, startH:hoursOf(st.cfg.start, 8), pauseH:pauseH, resumeH:hoursOf(st.cfg.resume, 13)};
      $('depTime').textContent = left > 0 ? clock(dep) : '—';
      $('depInfo').dataset.tip = st.moment === 'matin'
        ? 'Arrivée ' + st.cfg.start + ' + pause ' + fmt(st.cfg.pause || 0) + ' + ' + fmt(left)
        : 'Reprise ' + st.cfg.resume + ' + ' + fmt(left);
      dc.classList.toggle('warn', left > 0 && dep > hoursOf(st.cfg.end, 18) + 0.001);
    }else{ live = null; }
    tick();
    save(); notify();
  }

  function renderDate(){
    var s = new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    s = s.charAt(0).toUpperCase() + s.slice(1);
    if(st.mode === 'auto' && isWeekend()) s += ' (week-end : calcul à partir de vendredi)';
    if(st.mode !== 'auto' && (st.mode === '5' || st.mode === '6')) s += ' (jour forcé)';
    $('date').textContent = s;
  }
  function dropPastLocks(){
    var s = startIdx();
    Object.keys(st.locks).forEach(function(k){ if(+k < s) delete st.locks[k]; });
  }

  Array.prototype.forEach.call(document.querySelectorAll('input[name=moment]'), function(r){
    r.addEventListener('change', function(){
      st.moment = r.value; st.momentDay = dayStr();
      dropPastLocks(); update();
    });
  });

  [['tStart','start'],['tResume','resume'],['tEnd','end']].forEach(function(p){
    $(p[0]).addEventListener('input', function(){
      if(/^\d{1,2}:\d{2}$/.test(this.value)){ st.cfg[p[1]] = this.value; update(); }
    });
  });

  $('dayMode').addEventListener('change', function(){
    st.mode = $('dayMode').value;
    dropPastLocks(); renderDate(); update();
  });

  $('lockAll').addEventListener('click', function(){
    var c = compute();
    var allLocked = c.days.every(function(i){ return fixed(i) !== undefined; });
    if(allLocked) st.locks = {};
    else c.days.forEach(function(i){ if(!st.off[i]) st.locks[i] = c.values[i]; });
    update();
  });

  $('reset').addEventListener('click', function(){
    if(!confirm('Réinitialiser la semaine ? Les heures réalisées et les verrous seront effacés.')) return;
    var cfg = st.cfg;
    st = fresh(); st.cfg = cfg;
    $('dayMode').value = 'auto';
    renderDate(); update();
  });

  var chipRefs = [];
  DAYS.forEach(function(d, i){
    var lab = document.createElement('label'); lab.className = 'chip';
    var cb = document.createElement('input'); cb.type = 'checkbox';
    var sp = document.createElement('span'); sp.textContent = d;
    lab.appendChild(cb); lab.appendChild(sp); $('offChips').appendChild(lab);
    chipRefs[i] = {lab:lab, cb:cb};
    cb.addEventListener('change', function(){
      if(cb.checked){ st.off[i] = true; delete st.locks[i]; } else delete st.off[i];
      update();
    });
  });
  /* Cadran : 12 repères + chiffres 1 à 12 */
  (function(){
    var NS = 'http://www.w3.org/2000/svg';
    for(var q = 0; q < 12; q++){
      var a = q * 30 * Math.PI / 180;
      var tk = document.createElementNS(NS, 'line'); tk.setAttribute('class', 'tick');
      tk.setAttribute('x1', 60); tk.setAttribute('x2', 60); tk.setAttribute('y1', 5); tk.setAttribute('y2', q % 3 ? 8 : 11);
      tk.setAttribute('transform', 'rotate(' + q * 30 + ' 60 60)'); $('ticks').appendChild(tk);
      var tx = document.createElementNS(NS, 'text');
      tx.setAttribute('x', (60 + 41 * Math.sin(a)).toFixed(2)); tx.setAttribute('y', (60 - 41 * Math.cos(a)).toFixed(2));
      tx.textContent = q || 12; $('nums').appendChild(tx);
    }
  })();
  $('schoolCb').addEventListener('change', function(){ st.school = this.checked; update(); });
  $('doneBox').appendChild(hmDone.el);
  $('pauseBox').appendChild(hmPause.el);
  $('dayMode').value = st.mode;
  $('tStart').value = st.cfg.start;
  $('tResume').value = st.cfg.resume;
  $('tEnd').value = st.cfg.end;
  $('sGoal').textContent = fmt(GOAL);
  window.Planning = {
    makeHM: makeHM, fmt: fmt,
    snapshot: function(){
      var G = st.school ? 35 * 60 : GOAL;
      return {id: st.week, school: !!st.school, goal: G, done: st.school ? G : compute().eff};
    }
  };
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', tick);
  renderDate();
  update();
};