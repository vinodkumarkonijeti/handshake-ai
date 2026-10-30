(() => {
  const socket = io({ reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 700, reconnectionDelayMax: 5000, timeout: 10000 });
  const $ = id => document.getElementById(id);
  const screens = ['homeScreen','roomScreen','gameScreen','overScreen'];
  let state = null, myId = sessionStorage.getItem('snakeId') || null, myName = sessionStorage.getItem('snakeName') || '', currentCode = new URLSearchParams(location.search).get('room')?.toUpperCase() || '', lastStatus = '', toastTimer, lastStateAt = Date.now();
  const connectionLabel = $('connectionLabel');
  function showScreen(id) { screens.forEach(s => $(s).classList.toggle('hidden', s !== id)); }
  function showError(message) { $('entryError').textContent = message || ''; }
  function setConnection(connected) { connectionLabel.innerHTML = connected ? 'Connected' : '<span class="live-dot"></span> Reconnecting'; connectionLabel.classList.toggle('reconnecting', !connected); if (connected && currentCode && !state) tryRejoin(); }
  function tryRejoin() { if (myName && currentCode) socket.emit('rejoin-room', { code: currentCode, name: myName }); }
  socket.on('connect', () => setConnection(true));
  socket.on('disconnect', () => { setConnection(false); state = null; });
  socket.on('connect_error', () => setConnection(false));
  socket.on('joined-room', ({ code, id }) => { currentCode = code; myId = id; state = null; sessionStorage.setItem('snakeId', id); sessionStorage.setItem('snakeName', myName); history.replaceState({}, '', `?room=${code}`); showError(''); $('roomCodeDisplay').textContent = code; $('shareUrl').textContent = location.origin + `?room=${code}`; showScreen('roomScreen'); });
  socket.on('room-error', message => { if (currentCode && !state && $('roomScreen').classList.contains('hidden') === false) { showError(message); } else { showError(message); } });
  socket.on('state', next => {
    lastStateAt = Date.now(); const prior = state?.status; state = next;
    if (!myId) myId = sessionStorage.getItem('snakeId');
    if (next.status === 'waiting') { renderRoom(); showScreen('roomScreen'); }
    else if (next.status === 'playing') { $('gameRoomCode').textContent = next.code; $('roundNum').textContent = String(next.round).padStart(2,'0'); showScreen('gameScreen'); renderGame(); if (prior !== 'playing') announce('Match is live. Good luck!'); }
    else if (next.status === 'over') { renderOver(); showScreen('overScreen'); }
  });
  $('playerName').value = myName;
  if (currentCode) $('roomCode').value = currentCode;
  function readName() { const name = $('playerName').value.trim().slice(0,18); if (!name) { showError('Add your name before joining the arena.'); $('playerName').focus(); return null; } myName = name; sessionStorage.setItem('snakeName', name); showError(''); return name; }
  $('createBtn').addEventListener('click', () => { const name=readName(); if(name) socket.emit('create-room',{name}); });
  $('joinForm').addEventListener('submit', e => { e.preventDefault(); const name=readName(); if(name) socket.emit('join-room',{name,code:$('roomCode').value.trim().toUpperCase()}); });
  $('leaveBtn').addEventListener('click', () => { socket.emit('leave-room'); currentCode=''; state=null; sessionStorage.removeItem('snakeId'); history.replaceState({},'','/'); showScreen('homeScreen'); });
  $('copyBtn').addEventListener('click', async () => { const url=location.origin+`?room=${currentCode}`; try { await navigator.clipboard.writeText(url); $('copyBtn').innerHTML='<span>✓</span> Copied!'; setTimeout(()=>$('copyBtn').innerHTML='<span>▢</span> Copy invite',1500); } catch { $('shareUrl').textContent=url; announce('Copy the invite link shown above.'); } });
  $('startBtn').addEventListener('click', () => socket.emit('start-game'));
  $('replayBtn').addEventListener('click', () => socket.emit('restart-game'));
  $('backBtn').addEventListener('click', () => { socket.emit('leave-room'); currentCode=''; state=null; sessionStorage.removeItem('snakeId'); history.replaceState({},'','/'); showScreen('homeScreen'); });
  function renderRoom() {
    if (!state) return; $('roomCodeDisplay').textContent=state.code; $('shareUrl').textContent=location.origin+`?room=${state.code}`; $('playerCount').textContent=`${state.players.length} / 8`;
    $('playerList').innerHTML=state.players.map(p=>`<div class="player-chip"><span class="player-avatar" style="background:${p.color}">${esc(p.name[0]?.toUpperCase()||'?')}</span><span>${esc(p.name)}</span>${p.id===state.hostId?'<span class="host-tag">HOST</span>':''}</div>`).join('')+(state.players.length<2?'<div class="empty-player">Waiting for your first challenger…</div>':'');
    const host=state.hostId===myId; $('startBtn').classList.toggle('hidden',!host); $('hostHint').textContent=host?(state.players.length<2?'The room host can start once at least 2 players have joined.':'Your crew is here. Let the battle begin.'):'Waiting for the room host to start the match.';
  }
  function renderGame() {
    if(!state)return; const alive=state.players.filter(p=>p.alive&&p.connected).length;
    $('scoreList').innerHTML=[...state.players].sort((a,b)=>b.score-a.score).map(p=>`<div class="score-row ${p.alive&&p.connected?'':'dead'} ${p.id===myId?'you':''}"><span class="dot" style="background:${p.color}"></span><span class="score-name">${esc(p.name)}${p.connected?'':' (reconnecting)'}</span><span class="score-points">${p.score}</span></div>`).join('');
    $('aliveCount').innerHTML=`<i></i> ${alive} ALIVE`; $('foodCoordinate').textContent=`${String(state.food.x+1).padStart(2,'0')} : ${String(state.food.y+1).padStart(2,'0')}`; drawBoard();
  }
  function drawBoard() {
    const canvas=$('gameCanvas'),ctx=canvas.getContext('2d'),cw=canvas.width,ch=canvas.height,cols=state.width,rows=state.height,cell=cw/cols;
    ctx.clearRect(0,0,cw,ch); ctx.fillStyle='#141910';ctx.fillRect(0,0,cw,ch);
    ctx.strokeStyle='rgba(185,210,156,.055)';ctx.lineWidth=1; for(let x=0;x<=cols;x++){ctx.beginPath();ctx.moveTo(x*cell,0);ctx.lineTo(x*cell,ch);ctx.stroke()} for(let y=0;y<=rows;y++){ctx.beginPath();ctx.moveTo(0,y*cell);ctx.lineTo(cw,y*cell);ctx.stroke()}
    const fx=(state.food.x+.5)*cell,fy=(state.food.y+.5)*cell;ctx.save();ctx.shadowColor='#ffc857';ctx.shadowBlur=25;ctx.fillStyle='#ffc857';ctx.beginPath();ctx.arc(fx,fy,cell*.28,0,Math.PI*2);ctx.fill();ctx.restore();ctx.fillStyle='#fff0bc';ctx.beginPath();ctx.arc(fx,fy,cell*.1,0,Math.PI*2);ctx.fill();
    for(const p of state.players){if(!p.snake?.length)continue;ctx.save();ctx.shadowColor=p.color;ctx.shadowBlur=p.id===myId?13:8;for(let i=p.snake.length-1;i>=0;i--){const seg=p.snake[i],pad=i===0?cell*.11:cell*.16;ctx.globalAlpha=i===0?1:Math.max(.56,1-i/p.snake.length*.48);ctx.fillStyle=p.color;roundRect(ctx,seg.x*cell+pad,seg.y*cell+pad,cell-2*pad,cell-2*pad,cell*.25);ctx.fill()}const h=p.snake[0];ctx.globalAlpha=1;ctx.shadowBlur=0;ctx.fillStyle='#10130f';const eye=cell*.075;let ex=(h.x+.5)*cell,ey=(h.y+.5)*cell;ctx.beginPath();ctx.arc(ex-eye*1.4,ey-cell*.1,eye,0,Math.PI*2);ctx.arc(ex+eye*1.4,ey-cell*.1,eye,0,Math.PI*2);ctx.fill();ctx.restore()}
  }
  function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
  function announce(text){$('gameToast').textContent=text;$('gameToast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('gameToast').classList.add('hidden'),1800)}
  function renderOver(){if(!state)return;const winner=state.players.find(p=>p.id===state.winnerId);$('winnerTitle').textContent=winner?`${winner.name} takes the crown.`:'Round over.';$('winnerCopy').textContent=winner?`Clean moves, ${winner.name}. The arena belongs to you.`:'Everyone went down. That was a close one.';$('finalScores').innerHTML=[...state.players].sort((a,b)=>b.score-a.score).map((p,i)=>`<div class="final-score-row"><span class="rank">${String(i+1).padStart(2,'0')}</span><span class="dot" style="width:8px;height:8px;border-radius:2px;background:${p.color}"></span><span class="score-name">${esc(p.name)}</span><span class="score-points">${p.score} PTS</span></div>`).join('');const host=state.hostId===myId;$('replayBtn').classList.toggle('hidden',!host);$('replayHint').textContent=host?'Room host can launch another round.':'Waiting for the host to run it back.';}
  function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function sendDirection(dir){socket.emit('direction',dir)}
  const keyDirs={ArrowUp:'up',w:'up',W:'up',ArrowDown:'down',s:'down',S:'down',ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right'};
  window.addEventListener('keydown',e=>{const dir=keyDirs[e.key];if(dir){e.preventDefault();sendDirection(dir)}});
  $('mobileControls').addEventListener('click',e=>{const dir=e.target.closest('button')?.dataset.dir;if(dir)sendDirection(dir)});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&socket.connected&&currentCode&&!state)tryRejoin()});
  if(!socket.connected) connectionLabel.innerHTML='<span class="live-dot"></span> Connecting';
})();
