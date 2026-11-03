(() => {
  "use strict";
  const cfg = window.CRAZY_RESPONSES_CONFIG || {};
  const $ = id => document.getElementById(id);
  const state = {
    db:null, userId:localStorage.getItem("cr_player_id") || crypto.randomUUID(),
    username:localStorage.getItem("cr_username") || "", room:null, player:null,
    players:[], timer:null, heartbeat:null, realtime:[], refreshQueued:false,
    renderToken:0, sound:true, weekly:[], submissions:[], votes:[], chat:[],
    lastRenderedStatus:null, resultsTimerKey:null, busy:false
  };
  localStorage.setItem("cr_player_id", state.userId);
  const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const now = () => new Date().toISOString();
  const monday = () => { const d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-((d.getDay()+6)%7)); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
  const notify = msg => { $("toast").textContent=msg; $("toast").classList.add("show"); clearTimeout(state.toastTimer); state.toastTimer=setTimeout(()=>$ ("toast").classList.remove("show"),2600); };
  const sound = type => { if(!state.sound)return; try { const C=window.AudioContext||window.webkitAudioContext,ctx=new C(),o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=({tick:650,join:520,vote:760,win:880,transition:440}[type]||500);g.gain.setValueAtTime(.045,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.13);o.start();o.stop(ctx.currentTime+.14);o.onended=()=>ctx.close(); } catch {} };
  function screen(id){ document.querySelectorAll(".screen").forEach(x=>x.classList.toggle("active",x.id===id)); }
  function err(id,msg){ $(id).textContent=msg||""; }
  function getUsername(){ const n=$("usernameInput").value.trim(); if(n.length<2||n.length>18)throw Error("Your username must be 2–18 characters."); const changed=state.username!==n;state.username=n;localStorage.setItem("cr_username",n);if(changed&&state.db)state.db.from("weekly_scores").update({username:n,updated_at:now()}).eq("user_id",state.userId).then(({error})=>{if(error)console.warn("Leaderboard name update",error.message);});return n; }
  function isHost(){ return !!state.player?.is_host; }
  function activePlayers(){ return state.players.filter(p=>(p.joined_round||1)<=state.room.round_number); }
  function initDb(){
    if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY||!window.supabase){$("connectionState").innerHTML="<i></i> Config needed";return null;}
    const db=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    $("connectionState").innerHTML="<i></i> Connected";return db;
  }
  async function weekly(){
    if(!state.db)return;
    try{
      const {data,error}=await state.db.from("weekly_scores").select("user_id,username,points,first_reached_at").eq("week_start",monday()).order("points",{ascending:false}).order("first_reached_at",{ascending:true}).limit(10);
      if(error)throw error;state.weekly=data||[];
      $("leaderboardList").innerHTML=state.weekly.length?state.weekly.map((p,i)=>`<div class="leader-row"><span class="leader-rank">${String(i+1).padStart(2,"0")}</span><span class="leader-name">${esc(p.username)}${i===0?'<span class="crown">♛</span>':''}</span><span class="leader-score">${p.points} pts</span></div>`).join(""):'<div class="empty-state">No scores yet this week. Be the first.</div>';
    }catch(e){$("leaderboardList").innerHTML='<div class="empty-state">Leaderboard unavailable. Check that the database migration is installed.</div>';console.warn(e);}
  }
  async function getRoom(){
    if(!state.room||!state.db)return;
    const roomId=state.room.id;
    const {data:r,error}=await state.db.from("rooms").select("*").eq("id",roomId).maybeSingle();
    if(error)throw error;
    if(!r){notify("This room is no longer available.");return resetToHome();}
    state.room=r;
    const {data:ps,error:pe}=await state.db.from("players").select("*").eq("room_id",roomId).order("created_at");
    if(pe)throw pe;state.players=ps||[];state.player=state.players.find(p=>p.user_id===state.userId)||null;
    if(!state.player){notify("You are no longer in this room.");return resetToHome();}
    renderRoom();
    if(r.status==="lobby"){screen("roomScreen");await loadChat();}
    else await renderGame();
  }
  function renderRoom(){
    const r=state.room;if(!r)return;
    $("roomCodeLabel").textContent="ROOM · "+r.code;$("inviteCode").textContent=r.code;$("roomNameHeading").textContent=r.server_name||"Crazy Responses";
    $("roomMeta").textContent=`${state.players.length}/${r.max_players} players · ${r.round_count||5} rounds · ${r.is_public?"Public":"Private"}`;
    $("playerCount").textContent=`${state.players.length}/${r.max_players}`;$("roomStatusPill").textContent=r.status.toUpperCase();
    $("hostBadge").classList.toggle("hidden",!isHost());$("hostSettings").classList.toggle("hidden",!isHost()||r.status!=="lobby");$("startGameBtn").classList.toggle("hidden",!isHost()||r.status!=="lobby");
    $("startGameBtn").disabled=state.players.length<3;$("lobbyHint").textContent=state.players.length<3?"At least 3 players are needed to start.":"Everyone in? The host can start when ready.";
    ["editRoomName","editVisibility","editLimit","editRounds"].forEach(id=>$(id).disabled=r.status!=="lobby");
    $("editRoomName").value=r.server_name||"";$("editVisibility").value=String(r.is_public);$("editLimit").value=r.max_players;$("editRounds").value=r.round_count||5;
    $("playersList").innerHTML=state.players.map(p=>`<div class="player-row"><span class="avatar">${esc(p.username[0]?.toUpperCase()||"?")}</span><span class="player-name">${esc(p.username)}</span>${p.is_host?'<span class="host-tag">HOST</span>':''}${isHost()&&!p.is_host?`<button class="kick-button" data-kick="${esc(p.user_id)}">Kick</button>`:""}</div>`).join("");
  }
  async function createRoom(){
    if(state.busy)return;state.busy=true;
    try{
      const name=getUsername(),rounds=Number($("roundCount").value),limit=Number($("playerLimit").value);
      const code=Array.from(crypto.getRandomValues(new Uint8Array(6)),b=>(b%36).toString(36)).join("").toUpperCase();
      const roomName=$("roomNameInput").value.trim()||`${name}'s Room`;
      const {data:r,error}=await state.db.from("rooms").insert({code,host_id:state.userId,status:"lobby",round_number:0,server_name:roomName,round_count:rounds,is_public:$("visibility").value==="true",max_players:limit,prompt_style:$("promptStyle").value}).select().single();
      if(error)throw error;
      const {error:pe}=await state.db.from("players").insert({room_id:r.id,user_id:state.userId,username:name,is_host:true,score:0,round_wins:0,joined_round:1,last_seen_at:now()});
      if(pe){await state.db.from("rooms").delete().eq("id",r.id);throw pe;}
      await enterRoom(r);
    }catch(e){err("createError",e.message||"Couldn't create room.");}finally{state.busy=false;}
  }
  async function joinRoom(code){
    const name=getUsername();if(!code||code.length<4)throw Error("Enter a room code.");
    const {data:r,error}=await state.db.from("rooms").select("*").eq("code",code.toUpperCase()).maybeSingle();
    if(error||!r)throw Error("Room not found.");if(r.status==="finished")throw Error("That room has finished.");
    const {data:existing,error:ee}=await state.db.from("players").select("*").eq("room_id",r.id).eq("user_id",state.userId).maybeSingle();if(ee)throw ee;
    if(!existing){
      if(r.status!=="lobby"&&r.status!=="answering"&&r.status!=="voting"&&r.status!=="results")throw Error("That room is not accepting players.");
      const {count,error:ce}=await state.db.from("players").select("user_id",{count:"exact",head:true}).eq("room_id",r.id);if(ce)throw ce;
      if((count||0)>=r.max_players)throw Error("That room is full.");
      const joinedRound=r.status==="lobby"?1:r.round_number+1;
      const {error:pe}=await state.db.from("players").insert({room_id:r.id,user_id:state.userId,username:name,is_host:false,score:0,round_wins:0,joined_round:joinedRound,last_seen_at:now()});if(pe)throw pe;
    } else if(existing.username!==name){await state.db.from("players").update({username:name}).eq("room_id",r.id).eq("user_id",state.userId);}
    await enterRoom(r);
  }
  async function enterRoom(r){
    state.room=r;await getRoom();screen(state.room.status==="lobby"?"roomScreen":"gameScreen");subscribe();heartbeat();sound("join");
  }
  function subscribe(){
    state.realtime.forEach(c=>state.db.removeChannel(c));state.realtime=[];
    ["rooms","players","submissions","votes","lobby_chat","round_ready"].forEach(table=>{
      const channel=state.db.channel(`${table}-${state.room.id}`).on("postgres_changes",{event:"*",schema:"public",table,filter:`room_id=eq.${state.room.id}`},()=>queueRefresh()).subscribe();state.realtime.push(channel);
    });
  }
  function queueRefresh(){if(state.refreshQueued)return;state.refreshQueued=true;setTimeout(()=>{state.refreshQueued=false;getRoom().catch(e=>console.warn("Refresh failed",e));},180);}
  function heartbeat(){
    clearInterval(state.heartbeat);
    const beat=async()=>{if(!state.room)return;const {error}=await state.db.from("players").update({last_seen_at:now()}).eq("room_id",state.room.id).eq("user_id",state.userId);if(error)console.warn("Heartbeat",error.message);else { const m=await state.db.rpc("cr_maintain_room",{p_room_id:state.room.id}); if(m.error)console.warn("Room maintenance",m.error.message); }};beat();state.heartbeat=setInterval(beat,12000);
  }
  async function resetToHome(){
    state.room=null;state.player=null;clearInterval(state.heartbeat);clearInterval(state.timer);state.timer=null;
    state.realtime.forEach(c=>state.db.removeChannel(c));state.realtime=[];screen("homeScreen");await weekly();
  }
  async function leave(){
    if(!state.room)return;const r=state.room;
    try{
      if(isHost()){
        const {data:others}=await state.db.from("players").select("user_id,score,created_at").eq("room_id",r.id).neq("user_id",state.userId).order("score",{ascending:false}).order("created_at",{ascending:true}).limit(1);
        if(others?.length){const next=others[0];await state.db.from("players").update({is_host:true}).eq("room_id",r.id).eq("user_id",next.user_id);await state.db.from("players").update({is_host:false}).eq("room_id",r.id).eq("user_id",state.userId);await state.db.from("rooms").update({host_id:next.user_id}).eq("id",r.id);}
      }
      await state.db.from("players").delete().eq("room_id",r.id).eq("user_id",state.userId);
      const {count}=await state.db.from("players").select("user_id",{count:"exact",head:true}).eq("room_id",r.id);if(!count)await state.db.from("rooms").delete().eq("id",r.id);
    }catch(e){console.warn("Leave cleanup",e);}
    await resetToHome();
  }
  async function saveSettings(){
    if(!isHost()||state.room.status!=="lobby")return;
    try{const patch={server_name:$("editRoomName").value.trim()||"Crazy Responses",is_public:$("editVisibility").value==="true",max_players:Number($("editLimit").value),round_count:Number($("editRounds").value)};if(patch.max_players<state.players.length)throw Error("Player limit cannot be lower than the current player count.");const {error}=await state.db.from("rooms").update(patch).eq("id",state.room.id);if(error)throw error;notify("Room settings saved.");await getRoom();}catch(e){notify(e.message);}
  }
  const fallbackPrompts={
    comedy:["The worst thing to say during a job interview is _____.","My doctor told me I need to stop _____.","The secret ingredient in grandma's cooking is _____.","The most suspicious thing to find in a suitcase is _____.","I knew the date was going badly when they said _____.","The worst possible wedding toast begins with _____.","My autobiography will be titled _____."],
    chaotic:["The moon is actually made of _____.","The government's newest weapon is a giant _____.","Never feed a ____ after midnight.","Scientists have discovered that ____ can teleport.","The apocalypse began when someone accidentally _____.","The real reason dinosaurs went extinct was _____.","Our new national holiday celebrates _____."],
    mixed:["The fastest way to ruin a perfectly good party is _____.","The worst superpower imaginable is _____.","The one thing you should never bring to a wedding is _____.","Nobody expected the new school principal to be _____.","The emergency meeting was called because of _____.","The secret to becoming famous is _____.","The worst thing to hear from your pilot is _____."]
  };
  async function generatePrompt(style){
    try{const {data,error}=await state.db.functions.invoke("generate-prompt",{body:{style,avoid:state.room?.prompt||null}});if(!error&&typeof data?.prompt==="string"&&data.prompt.includes("____")&&data.prompt.length<240)return data.prompt;}catch(e){console.info("Using local prompt fallback",e.message);}
    const list=fallbackPrompts[style]||fallbackPrompts.mixed;let choices=list.filter(p=>p!==state.room?.prompt);if(!choices.length)choices=list;return choices[Math.floor(Math.random()*choices.length)];
  }
  async function startGame(){
    if(!isHost()||state.players.length<3||state.busy)return;state.busy=true;
    try{const prompt=await generatePrompt(state.room.prompt_style||"mixed");await state.db.from("round_ready").delete().eq("room_id",state.room.id);const {error}=await state.db.from("rooms").update({status:"answering",round_number:1,prompt,round_started_at:null,round_deadline_at:null,voting_deadline_at:null,results_deadline_at:null,round_winner_submission_id:null}).eq("id",state.room.id);if(error)throw error;await getRoom();}catch(e){notify("Couldn't start: "+e.message);}finally{state.busy=false;}
  }
  async function markReady(){
    try{const {error}=await state.db.rpc("cr_mark_ready",{p_room_id:state.room.id,p_user_id:state.userId});if(error)throw error;sound("transition");await getRoom();}catch(e){notify("Couldn't mark ready. Run the updated SQL migration first. "+e.message);}
  }
  async function renderGame(){
    const r=state.room;if(!r)return;screen("gameScreen");const token=++state.renderToken;const total=r.round_count||5;
    $("gameRoundPill").textContent=r.status==="finished"?"FINAL RESULTS":`ROUND ${r.round_number} / ${total}`;
    $("gameProgress").innerHTML=`<span style="width:${Math.max(0,Math.min(100,(r.round_number/total)*100))}%"></span>`;
    if(r.status==="finished"){clearInterval(state.timer);state.timer=null;await showFinalResults();return;}
    if(r.status==="results"){clearInterval(state.timer);state.timer=null;await showRoundResults(token);return;}
    const [{data:subs,error:se},{data:votes,error:ve},{data:ready,error:re}]=await Promise.all([
      state.db.from("submissions").select("*").eq("room_id",r.id).eq("round_number",r.round_number),
      state.db.from("votes").select("*").eq("room_id",r.id).eq("round_number",r.round_number).order("created_at"),
      state.db.from("round_ready").select("user_id").eq("room_id",r.id).eq("round_number",r.round_number)
    ]);
    if(token!==state.renderToken)return;if(se||ve||re)throw se||ve||re;
    state.submissions=subs||[];state.votes=votes||[];
    const spectator=state.player&&(state.player.joined_round||1)>r.round_number;
    if(r.status==="answering"){
      if(spectator){clearInterval(state.timer);$("gameTimer").textContent="SPECTATING";$("gameContent").innerHTML='<div class="prompt-card"><div class="eyebrow">SPECTATOR MODE</div><div class="prompt-text">You joined mid-round. You will play when the next round begins.</div></div>';return;}
      const readyIds=new Set((ready||[]).map(x=>x.user_id)),active=activePlayers(),allReady=active.length>0&&active.every(p=>readyIds.has(p.user_id));
      if(!r.round_deadline_at){clearInterval(state.timer);state.timer=null;$("gameTimer").textContent="READY UP";$("gameContent").innerHTML=`<div class="prompt-card"><div class="eyebrow">FILL IN THE BLANK · ROUND ${r.round_number}</div><div class="prompt-text">${esc(r.prompt).replace(/_{3,}/g,'<span class="blank">YOUR ANSWER</span>')}</div></div><div class="panel center"><h2>${allReady?"Everyone is ready!":"Waiting for players"}</h2><p class="field-help">${readyIds.size} of ${active.length} active players ready. The 60-second timer starts when everyone is ready.</p>${readyIds.has(state.userId)?'<p class="field-help">You are ready. Hang tight…</p>':'<button class="button primary" id="readyBtn">I\'m ready ↗</button>'}</div>`;const b=$("readyBtn");if(b)b.onclick=markReady;return;}
      startTimer(r.round_deadline_at,advanceToVoting);
      const mine=state.submissions.find(s=>s.user_id===state.userId);
      if(mine){$("gameContent").innerHTML=`<div class="prompt-card"><div class="eyebrow">YOUR ANSWER IS IN</div><div class="prompt-text">${esc(r.prompt)}</div><div class="answer-box"><div class="answer-card"><p>${esc(mine.answer)}</p></div></div><p class="field-help">Your answer is submitted. You can edit it once before voting begins.</p><button class="button secondary" id="editAnswerBtn">Edit answer once</button>`;$("editAnswerBtn").onclick=()=>editAnswer(mine);return;}
      $("gameContent").innerHTML=`<div class="prompt-card"><div class="eyebrow">FILL IN THE BLANK</div><div class="prompt-text">${esc(r.prompt).replace(/_{3,}/g,'<span class="blank">YOUR ANSWER</span>')}</div></div><div class="answer-box"><textarea id="answerInput" maxlength="180" placeholder="Type your funniest answer…"></textarea><div class="answer-meta"><span>2–180 characters</span><span id="answerCount">0 / 180</span></div><div class="button-row"><button class="button primary full" id="submitAnswerBtn">Lock in answer ↗</button></div></div>`;
      $("answerInput").addEventListener("input",()=>$("answerCount").textContent=$("answerInput").value.length+" / 180");$("submitAnswerBtn").onclick=submitAnswer;return;
    }
    if(r.status==="voting"){
      if(spectator){clearInterval(state.timer);$("gameTimer").textContent="SPECTATING";$("gameContent").innerHTML='<div class="prompt-card"><div class="eyebrow">SPECTATOR MODE</div><div class="prompt-text">Voting is underway. You will join next round.</div></div>';return;}
      startTimer(r.voting_deadline_at,finishVoting);
      const {data:myVote,error}=await state.db.from("votes").select("submission_id").eq("room_id",r.id).eq("round_number",r.round_number).eq("user_id",state.userId).maybeSingle();if(token!==state.renderToken)return;if(error)throw error;
      const eligible=state.submissions.filter(s=>s.user_id!==state.userId);
      $("gameContent").innerHTML=`<div class="center"><div class="eyebrow">PICK THE FUNNIEST</div><h2>Which response wins?</h2><p class="field-help">Answers are anonymous. You cannot vote for yourself. One vote per round.</p></div><div class="answer-cards">${eligible.map((s,i)=>`<div class="answer-card ${myVote?.submission_id===s.id?"selected":""}" data-vote="${esc(s.id)}" role="button" tabindex="0"><p>${esc(s.answer)}</p><small>RESPONSE ${String(i+1).padStart(2,"0")}</small></div>`).join("")||'<div class="empty-state">No eligible answers were submitted.</div>'}</div>${myVote?'<p class="center field-help">Your vote is locked in.</p>':'<p class="center field-help">Tap a card to cast your vote.</p>'}`;
      document.querySelectorAll("[data-vote]").forEach(el=>{el.onclick=()=>castVote(el.dataset.vote);el.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();castVote(el.dataset.vote);}};});return;
    }
  }
  async function submitAnswer(){
    const answer=$("answerInput").value.trim();if(answer.length<2||answer.length>180)return notify("Your answer must be 2–180 characters.");
    const {error}=await state.db.rpc("cr_submit_answer",{p_room_id:state.room.id,p_user_id:state.userId,p_answer:answer,p_username:state.username});if(error)return notify(error.message);sound("vote");await getRoom();
  }
  async function editAnswer(sub){
    const next=prompt("Edit your answer (you only get one edit):",sub.answer);if(next===null)return;const answer=next.trim();if(answer.length<2||answer.length>180)return notify("Your answer must be 2–180 characters.");
    const {error}=await state.db.rpc("cr_edit_submission",{p_submission_id:sub.id,p_user_id:state.userId,p_answer:answer});if(error)return notify(error.message);await getRoom();
  }
  async function castVote(id){
    const sub=state.submissions.find(s=>s.id===id);if(!sub||sub.user_id===state.userId)return;
    const {error}=await state.db.rpc("cr_cast_vote",{p_room_id:state.room.id,p_user_id:state.userId,p_submission_id:id});if(error)return notify(error.message);sound("vote");await getRoom();
  }
  function startTimer(deadline,onDone){
    const key=String(deadline);if(state.timer&&state.timerKey===key)return;clearInterval(state.timer);state.timer=null;state.timerKey=key;
    const tick=()=>{if(state.timerKey!==key)return;const ms=new Date(deadline).getTime()-Date.now();$("gameTimer").textContent=ms>0?`${String(Math.floor(ms/60000)).padStart(2,"0")}:${String(Math.floor(ms/1000)%60).padStart(2,"0")}`:"00:00";if(ms<=0){clearInterval(state.timer);state.timer=null;state.timerKey=null;onDone().catch(e=>notify(e.message));}else if(ms<10000&&Math.ceil(ms/1000)%2===0)sound("tick");};tick();state.timer=setInterval(tick,1000);
  }
  async function advanceToVoting(){
    if(!isHost()||state.room.status!=="answering")return;
    const {error}=await state.db.rpc("cr_advance_to_voting",{p_room_id:state.room.id,p_user_id:state.userId});if(error){notify("Couldn't start voting: "+error.message);return;}clearInterval(state.timer);state.timer=null;await getRoom();
  }
  async function finishVoting(){
    if(!isHost()||state.room.status!=="voting")return;
    const {error}=await state.db.rpc("cr_settle_round",{p_room_id:state.room.id,p_user_id:state.userId});if(error){notify("Couldn't finish voting: "+error.message);return;}clearInterval(state.timer);state.timer=null;await getRoom();weekly();sound("win");
  }
  async function showRoundResults(token){
    const r=state.room;
    const [{data:players,error:pe},{data:subs,error:se},{data:votes,error:ve}]=await Promise.all([
      state.db.from("players").select("*").eq("room_id",r.id),state.db.from("submissions").select("*").eq("room_id",r.id).eq("round_number",r.round_number),state.db.from("votes").select("*").eq("room_id",r.id).eq("round_number",r.round_number)
    ]);if(token!==state.renderToken)return;if(pe||se||ve)throw pe||se||ve;
    const tally={};(votes||[]).forEach(v=>tally[v.submission_id]=(tally[v.submission_id]||0)+1);
    const roundPoints={};(subs||[]).forEach(s=>roundPoints[s.user_id]=tally[s.id]||0);
    const sorted=(players||[]).sort((a,b)=>(b.score||0)-(a.score||0)||(a.created_at||"").localeCompare(b.created_at||""));
    const winnerSub=(subs||[]).find(s=>s.id===r.round_winner_submission_id);
    $("gameTimer").textContent="NEXT ROUND";
    $("gameContent").innerHTML=`<div class="prompt-card"><div class="eyebrow">ROUND ${r.round_number} RESULTS</div><h2>${winnerSub?`🏆 ${esc(winnerSub.author_name)} wins the round!`:"Round complete"}</h2><p class="field-help">${winnerSub?esc(winnerSub.answer):"No votes were cast."}</p></div><div class="panel"><div class="panel-heading"><h2>Round leaderboard</h2><span class="pill">TOTAL SCORES</span></div><div class="result-list">${sorted.map((p,i)=>`<div class="result-row"><span class="leader-rank">${i+1}</span><span><strong>${esc(p.username)}</strong><small class="field-help"> · ${roundPoints[p.user_id]||0} points this round · ${p.round_wins||0} round wins</small></span><span class="result-points">${p.score||0} pts</span></div>`).join("")}</div></div><div class="button-row">${isHost()?'<button class="button primary full" id="continueBtn">Continue ↗</button>':'<p class="field-help center">The host will continue automatically in 15 seconds.</p>'}</div>`;
    if(isHost())$("continueBtn").onclick=continueRound;
    const timerKey=`${r.id}:${r.round_number}`;
    if(isHost()&&state.resultsTimerKey!==timerKey){state.resultsTimerKey=timerKey;clearTimeout(state.resultsTimeout);const remaining=r.results_deadline_at?Math.max(0,new Date(r.results_deadline_at).getTime()-Date.now()):15000;state.resultsTimeout=setTimeout(()=>continueRound().catch(e=>notify(e.message)),remaining);}
  }
  async function continueRound(){
    if(!isHost()||state.room.status!=="results")return;clearTimeout(state.resultsTimeout);state.resultsTimerKey=null;
    const total=state.room.round_count||5;
    if(state.room.round_number>=total){const {error}=await state.db.from("rooms").update({status:"finished"}).eq("id",state.room.id);if(error)throw error;}
    else{const prompt=await generatePrompt(state.room.prompt_style||"mixed");await state.db.from("round_ready").delete().eq("room_id",state.room.id);const {error}=await state.db.from("rooms").update({status:"answering",round_number:state.room.round_number+1,prompt,round_started_at:null,round_deadline_at:null,voting_deadline_at:null,results_deadline_at:null,round_winner_submission_id:null}).eq("id",state.room.id);if(error)throw error;}
    await getRoom();
  }
  async function showFinalResults(){
    const {data:players,error}=await state.db.from("players").select("*").eq("room_id",state.room.id);if(error)throw error;
    const sorted=(players||[]).sort((a,b)=>(b.round_wins||0)-(a.round_wins||0)||(b.score||0)-(a.score||0)||(a.created_at||"").localeCompare(b.created_at||""));const top=sorted.slice(0,3);
    $("gameTimer").textContent="FINAL";
    $("gameContent").innerHTML=`<div class="center"><div class="eyebrow">GAME OVER</div><h1 style="font-size:48px;letter-spacing:-3px">The <span style="color:var(--accent)">podium.</span></h1><p class="field-help">Most round wins takes the crown. Total points break ties.</p></div><div class="podium">${[top[1],top[0],top[2]].map((p,i)=>p?`<div class="podium-place ${i===1?"first":i===0?"second":"third"}"><span>${i===1?"1ST PLACE":i===0?"2ND PLACE":"3RD PLACE"}</span><b>${i===1?"♛":i===0?"Ⅱ":"Ⅲ"}</b><strong>${esc(p.username)}</strong><span>${p.round_wins||0} round wins · ${p.score||0} pts</span></div>`:"").join("")}</div><div class="panel"><h2>Final standings</h2><div class="result-list">${sorted.map((p,i)=>`<div class="result-row"><span class="leader-rank">${i+1}</span><strong>${esc(p.username)}</strong><span class="result-points">${p.round_wins||0} wins · ${p.score||0} pts</span></div>`).join("")}</div></div><div class="button-row">${isHost()?'<button class="button primary full" id="playAgainBtn">Play again in this room ↗</button>':''}<button class="button secondary full" id="homeFromFinal">Main menu</button></div>`;
    const again=$("playAgainBtn");if(again)again.onclick=playAgain;$("homeFromFinal").onclick=leave;
  }
  async function playAgain(){
    if(!isHost())return notify("Only the host can start a rematch.");
    try{
      const id=state.room.id;
      for(const table of ["submissions","votes","round_ready"]){const {error}=await state.db.from(table).delete().eq("room_id",id);if(error)throw error;}
      const {error:pe}=await state.db.from("players").update({score:0,round_wins:0,joined_round:1}).eq("room_id",id);if(pe)throw pe;
      const {error:re}=await state.db.from("rooms").update({status:"lobby",round_number:0,prompt:null,round_started_at:null,round_deadline_at:null,voting_deadline_at:null,results_deadline_at:null,round_winner_submission_id:null}).eq("id",id);if(re)throw re;
      state.resultsTimerKey=null;await getRoom();screen("roomScreen");
    }catch(e){notify("Couldn't restart room: "+e.message);}
  }
  async function sendChat(e){
    e.preventDefault();const message=$("chatInput").value.trim();if(!message||!state.room)return;
    const {error}=await state.db.from("lobby_chat").insert({room_id:state.room.id,user_id:state.userId,username:state.username,message});if(error)notify(error.message);else $("chatInput").value="";
  }
  async function loadChat(){
    if(!state.room||state.room.status!=="lobby")return;const {data,error}=await state.db.from("lobby_chat").select("*").eq("room_id",state.room.id).order("created_at").limit(60);if(error)return console.warn(error);
    $("chatMessages").innerHTML=(data||[]).map(m=>`<div class="chat-message"><strong>${esc(m.username)}</strong>${esc(m.message)}</div>`).join("")||'<div class="empty-state">Say something questionable.</div>';$ ("chatMessages").scrollTop=$("chatMessages").scrollHeight;
  }
  async function browser(){
    screen("browserScreen");$("publicRoomsList").innerHTML='<div class="empty-state">Loading rooms…</div>';
    const {data,error}=await state.db.from("rooms").select("id,code,server_name,max_players,round_count,created_at").eq("status","lobby").eq("is_public",true).order("created_at",{ascending:false}).limit(30);
    if(error){$("publicRoomsList").innerHTML='<div class="empty-state">Could not load public rooms. Check your database migration.</div>';return;}
    const rooms=data||[];const counts=await Promise.all(rooms.map(r=>state.db.from("players").select("user_id",{count:"exact",head:true}).eq("room_id",r.id)));
    $("publicRoomsList").innerHTML=rooms.map((r,i)=>{const count=counts[i].count||0;return `<div class="public-room"><div><strong>${esc(r.server_name||"Crazy Responses")}</strong><small>${esc(r.code)} · ${count}/${r.max_players} players · ${r.round_count||5} rounds</small></div><button class="button primary small" data-join="${esc(r.code)}" ${count>=r.max_players?"disabled":""}>Join</button></div>`;}).join("")||'<div class="empty-state">No public rooms right now. Create one!</div>';
    document.querySelectorAll("[data-join]").forEach(b=>b.onclick=()=>joinRoom(b.dataset.join).catch(e=>notify(e.message)));
  }
  function bind(){
    $("usernameInput").value=state.username;
    $("createRoomBtn").onclick=()=>{try{getUsername();err("homeError","");screen("createScreen");}catch(e){err("homeError",e.message);}};
    $("showJoinBtn").onclick=()=>$("joinRow").classList.toggle("hidden");
    $("joinRoomBtn").onclick=()=>joinRoom($("roomCodeInput").value.trim()).catch(e=>err("homeError",e.message));
    $("confirmCreateBtn").onclick=createRoom;$("leaveRoomBtn").onclick=leave;$("gameLeaveBtn").onclick=leave;$("startGameBtn").onclick=startGame;$("saveSettingsBtn").onclick=saveSettings;
    $("copyCodeBtn").onclick=()=>navigator.clipboard.writeText(state.room.code).then(()=>notify("Invite code copied.")).catch(()=>notify("Clipboard unavailable."));
    $("chatForm").onsubmit=sendChat;$("refreshRoomsBtn").onclick=browser;
    $("brandHome").onclick=e=>{e.preventDefault();if(state.room)leave();else screen("homeScreen");};
    document.querySelectorAll("[data-screen]").forEach(b=>b.onclick=()=>screen(b.dataset.screen));
    $("themeToggle").onclick=()=>{document.documentElement.classList.toggle("light");localStorage.setItem("cr_theme",document.documentElement.classList.contains("light")?"light":"dark");};
    $("soundToggle").onclick=()=>{state.sound=!state.sound;$("soundToggle").style.opacity=state.sound?"1":".4";notify(state.sound?"Sound on":"Sound muted");};
    $("modalClose").onclick=()=>$("modalBackdrop").classList.add("hidden");
    $("playersList").addEventListener("click",async e=>{const b=e.target.closest("[data-kick]");if(!b||!isHost())return;if(!confirm("Kick this player from the room?"))return;const {error}=await state.db.from("players").delete().eq("room_id",state.room.id).eq("user_id",b.dataset.kick);if(error)notify(error.message);else await getRoom();});
  }
  async function boot(){
    if(localStorage.getItem("cr_theme")==="light")document.documentElement.classList.add("light");bind();state.db=initDb();if(!state.db)return;
    await state.db.rpc("cr_cleanup_empty_rooms").catch(e=>console.warn("Room cleanup",e));await weekly();setInterval(weekly,60000);
    // Make the public-room browser reachable from the home screen even on narrow layouts.
    const homePanel=document.querySelector("#homeScreen .home-panel .button-row");
    if(homePanel&&!$("browseRoomsBtn")){const b=document.createElement("button");b.id="browseRoomsBtn";b.className="button secondary";b.textContent="Browse public rooms";b.onclick=browser;homePanel.appendChild(b);}
  }
  document.addEventListener("DOMContentLoaded",boot);
})();
