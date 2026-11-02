(() => {
  const cfg = window.CRAZY_RESPONSES_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT") &&
    cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");
  const $ = id => document.getElementById(id);
  const screens = ["setup-screen","lobby-screen","game-screen","vote-screen","results-screen","final-screen"];
  const prompts = [
    "The worst thing to hear from your doctor is ______.",
    "The secret ingredient in grandma's cooking is ______.",
    "The real reason the internet went down was ______.",
    "If pets could talk, the first thing my dog would say is ______.",
    "The worst superpower to have would be ______.",
    "The weirdest thing to bring to a job interview is ______.",
    "The world's least useful invention is ______.",
    "I knew the camping trip was doomed when ______.",
    "The only thing scarier than a clown is ______.",
    "The new school rule is that everyone must ______."
  ];
  const state = {client:null,userId:localStorage.getItem("cr-user-id") || crypto.randomUUID(),
    username:localStorage.getItem("cr-username") || "",room:null,players:[],round:null,
    submissions:[],votes:[],selectedVote:null,channel:null,timer:null,refreshing:false};
  localStorage.setItem("cr-user-id",state.userId);
  const say = (id,msg) => { $(id).textContent = msg || ""; };
  const show = id => { screens.forEach(s => $(s).classList.toggle("hidden",s!==id)); };
  const err = msg => say("setup-error",msg);
  const isHost = () => state.room && state.room.host_id === state.userId;
  const esc = s => String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const shuffle = a => [...a].sort(()=>Math.random()-.5);
  const randomCode = () => Math.random().toString(36).slice(2,8).toUpperCase();

  function connect() {
    if (!configured || !window.supabase) {
      $("connection").textContent = "Setup needed";
      $("connection").style.color = "#bd6a2e";
      return false;
    }
    state.client = window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    $("connection").textContent = "Connected to game service";
    $("connection").style.color = "#388b67";
    return true;
  }
  const db = () => state.client;
  async function savePlayer() {
    const name = $("username").value.trim().replace(/\s+/g," ");
    if (!name || name.length < 2) throw new Error("Choose a username with at least 2 characters.");
    if (name.length > 18) throw new Error("Usernames can be up to 18 characters.");
    state.username = name;
    localStorage.setItem("cr-username",name);
  }
  async function createRoom() {
    try {
      await savePlayer();
      if (!connect()) throw new Error("Add your Supabase settings to config.js first. See README.");
      let code = randomCode();
      let {data:room,error:e} = await db().from("rooms").insert({code,host_id:state.userId,status:"lobby",round_number:0}).select().single();
      if (e) throw e;
      state.room=room;
      const {error:pe}=await db().from("players").insert({room_id:room.id,user_id:state.userId,username:state.username,is_host:true,score:0});
      if(pe) throw pe;
      await enterRoom();
    } catch(e) { err(e.message || "Couldn't create the room."); }
  }
  async function joinRoom() {
    try {
      await savePlayer();
      if (!connect()) throw new Error("Add your Supabase settings to config.js first. See README.");
      const code=$("room-code").value.trim().toUpperCase();
      if(code.length!==6) throw new Error("Enter the 6-character room code.");
      const {data:room,error:e}=await db().from("rooms").select("*").eq("code",code).maybeSingle();
      if(e) throw e;
      if(!room) throw new Error("That room code wasn't found.");
      if(room.status!=="lobby") throw new Error("That game has already started.");
      const {data:members,error:me}=await db().from("players").select("*").eq("room_id",room.id);
      if(me) throw me;
      if(members.length>=10) throw new Error("This room is full (10 players maximum).");
      if(members.some(p=>p.user_id===state.userId)) { state.room=room; await enterRoom(); return; }
      const {error:pe}=await db().from("players").insert({room_id:room.id,user_id:state.userId,username:state.username,is_host:false,score:0});
      if(pe) throw pe;
      state.room=room; await enterRoom();
    } catch(e) { err(e.message || "Couldn't join the room."); }
  }
  async function enterRoom() {
    show("lobby-screen"); $("display-room-code").textContent=state.room.code;
    if(state.channel) await db().removeChannel(state.channel);
    state.channel=db().channel("room-"+state.room.id)
      .on("postgres_changes",{event:"*",schema:"public",table:"players",filter:"room_id=eq."+state.room.id},refresh)
      .on("postgres_changes",{event:"*",schema:"public",table:"rooms",filter:"id=eq."+state.room.id},refresh)
      .on("postgres_changes",{event:"*",schema:"public",table:"submissions",filter:"room_id=eq."+state.room.id},refresh)
      .on("postgres_changes",{event:"*",schema:"public",table:"votes",filter:"room_id=eq."+state.room.id},refresh)
      .subscribe();
    await refresh();
  }
  async function refresh() {
    if(!state.room || state.refreshing) return;
    state.refreshing=true;
    try {
      const [r,p,s,v]=await Promise.all([
        db().from("rooms").select("*").eq("id",state.room.id).single(),
        db().from("players").select("*").eq("room_id",state.room.id).order("created_at"),
        db().from("submissions").select("*").eq("room_id",state.room.id),
        db().from("votes").select("*").eq("room_id",state.room.id)
      ]);
      if(r.error||p.error||s.error||v.error) throw r.error||p.error||s.error||v.error;
      state.room=r.data; state.players=p.data; state.submissions=s.data; state.votes=v.data;
      if(state.room.status==="lobby") renderLobby();
      else if(state.room.status==="answering") renderGame();
      else if(state.room.status==="voting") renderVote();
      else if(state.room.status==="results") renderResults();
      else if(state.room.status==="finished") renderFinal();
    } catch(e) { console.error(e); }
    finally { state.refreshing=false; }
  }
  function renderLobby() {
    show("lobby-screen");
    $("display-room-code").textContent=state.room.code;
    $("player-count").textContent=state.players.length+" / 10";
    $("player-list").innerHTML=state.players.map(p=>`<li><span class="player-name"><span class="avatar">${esc(p.username.slice(0,1).toUpperCase())}</span>${esc(p.username)} ${p.is_host?'<span class="host-tag">HOST</span>':""}</span><span class="muted small">${p.user_id===state.userId?"YOU":""}</span></li>`).join("");
    $("host-controls").classList.toggle("hidden",!isHost());
    $("start-game").disabled=!isHost()||state.players.length<3||state.players.length>10;
    say("lobby-status",state.players.length<3?"Waiting for at least 3 players…":isHost()?"Everyone here? Start when ready.":"Waiting for the host to start.");
  }
  async function startGame() {
    if(!isHost()||state.players.length<3||state.players.length>10)return;
    const prompt=prompts[Math.floor(Math.random()*prompts.length)];
    const {error:e}=await db().from("rooms").update({status:"answering",round_number:1,prompt,round_started_at:new Date().toISOString()}).eq("id",state.room.id);
    if(e) alert(e.message);
    await refresh();
  }
  function mySubmission(){return state.submissions.find(s=>s.user_id===state.userId);}
  function renderGame() {
    show("game-screen");
    $("round-label").textContent=`ROUND ${state.room.round_number} / 5`;
    $("prompt-text").textContent=state.room.prompt;
    const mine=mySubmission(),submitted=state.submissions.length;
    $("answer-area").classList.toggle("hidden",!!mine);
    $("submitted-message").classList.toggle("hidden",!mine);
    $("submission-count").textContent=`${submitted} / ${state.players.length} submitted`;
    $("submission-progress").firstElementChild.style.width=(submitted/state.players.length*100)+"%";
    say("game-status",submitted===state.players.length?"All answers are in! Moving to voting…":"Answers stay hidden until everyone submits.");
    say("timer-label","Take your time");
    if(isHost()&&submitted===state.players.length) moveToVoting();
  }
  async function submitAnswer() {
    const answer=$("answer-input").value.trim();
    if(answer.length<2){say("game-status","Write an answer before submitting.");return;}
    const {error:e}=await db().from("submissions").insert({room_id:state.room.id,round_number:state.room.round_number,user_id:state.userId,answer});
    if(e) say("game-status",e.message);
    else $("answer-input").value="";
    await refresh();
  }
  async function moveToVoting() {
    if(!isHost()||state.room.status!=="answering")return;
    const {error:e}=await db().from("rooms").update({status:"voting"}).eq("id",state.room.id).eq("status","answering");
    if(e) console.error(e);
    await refresh();
  }
  function renderVote() {
    show("vote-screen"); $("vote-round-label").textContent=`ROUND ${state.room.round_number} / 5`;
    const mine=mySubmission(),already=state.votes.some(v=>v.user_id===state.userId);
    const options=shuffle(state.submissions);
    $("answer-options").innerHTML=options.map(s=>`<button class="answer-option ${state.selectedVote===s.id?"selected":""}" data-id="${s.id}" ${s.user_id===state.userId||already?"disabled":""}>${esc(s.answer)}</button>`).join("");
    document.querySelectorAll(".answer-option").forEach(b=>b.addEventListener("click",()=>{state.selectedVote=b.dataset.id;renderVote();}));
    $("cast-vote").disabled=!state.selectedVote||already;
    $("cast-vote").textContent=already?"Vote submitted":"Cast my vote";
    say("vote-status",already?"Your vote has been recorded.":mine?"Choose your favorite answer. You cannot vote for your own.":"Choose the funniest answer.");
    if(isHost()&&state.votes.length>=state.players.length) finishRound();
  }
  async function castVote() {
    if(!state.selectedVote)return;
    const target=state.submissions.find(s=>s.id===state.selectedVote);
    if(!target||target.user_id===state.userId)return;
    const {error:e}=await db().from("votes").insert({room_id:state.room.id,round_number:state.room.round_number,user_id:state.userId,submission_id:target.id});
    if(e) say("vote-status",e.message);
    state.selectedVote=null; await refresh();
  }
  async function finishRound() {
    if(!isHost()||state.room.status!=="voting")return;
    const {error:e}=await db().from("rooms").update({status:"results"}).eq("id",state.room.id).eq("status","voting");
    if(e) console.error(e);
    await refresh();
  }
  function scores() {
    const counts={}; state.votes.forEach(v=>counts[v.submission_id]=(counts[v.submission_id]||0)+1);
    const winners=state.submissions.map(s=>({...s,vote_count:counts[s.id]||0})).sort((a,b)=>b.vote_count-a.vote_count);
    return {counts,winners};
  }
  function renderResults() {
    show("results-screen");
    const {winners}=scores(),winner=winners[0];
    $("round-winner-title").textContent=winner&&winner.vote_count?"The winner is…":"It's a tie!";
    $("winning-answer").textContent=winner?`“${winner.answer}”`:"No votes were cast.";
    const author=state.players.find(p=>p.user_id===winner?.user_id);
    $("winning-player").textContent=winner?`${author?.username||"A player"} · ${winner.vote_count} vote(s)`:"";
    $("results-round").textContent=`Round ${state.room.round_number} of 5`;
    const ranking=state.players.map(p=>({...p,score:p.score+(winner&&p.user_id===winner.user_id?winner.vote_count:0)})).sort((a,b)=>b.score-a.score);
    $("leaderboard").innerHTML=ranking.map((p,i)=>`<li><span class="player-name"><span class="rank">${i+1}.</span>${esc(p.username)}</span><span class="score">${p.score} pts</span></li>`).join("");
    $("next-round").classList.toggle("hidden",!isHost());
    say("results-status",isHost()?"Start the next round when everyone has seen the results.":"Waiting for the host to continue.");
  }
  async function nextRound() {
    if(!isHost())return;
    const {winners}=scores(),winner=winners[0];
    if(winner&&winner.vote_count) {
      const p=state.players.find(p=>p.user_id===winner.user_id);
      if(p) await db().from("players").update({score:p.score+winner.vote_count}).eq("id",p.id);
    }
    if(state.room.round_number>=5) {
      await db().from("rooms").update({status:"finished"}).eq("id",state.room.id);
    } else {
      await db().from("submissions").delete().eq("room_id",state.room.id);
      await db().from("votes").delete().eq("room_id",state.room.id);
      const prompt=prompts[Math.floor(Math.random()*prompts.length)];
      await db().from("rooms").update({status:"answering",round_number:state.room.round_number+1,prompt,round_started_at:new Date().toISOString()}).eq("id",state.room.id);
    }
    await refresh();
  }
  function renderFinal() {
    show("final-screen");
    const ranking=[...state.players].sort((a,b)=>b.score-a.score);
    $("final-winner").textContent=ranking.length?`${ranking[0].username} wins with ${ranking[0].score} points!`:"Game finished.";
    $("final-leaderboard").innerHTML=ranking.map((p,i)=>`<li><span class="player-name"><span class="rank">${i+1}.</span>${esc(p.username)}</span><span class="score">${p.score} pts</span></li>`).join("");
  }
  async function leaveRoom() {
    if(state.channel) await db().removeChannel(state.channel);
    if(state.room) await db().from("players").delete().eq("room_id",state.room.id).eq("user_id",state.userId);
    state.room=null;state.players=[];state.submissions=[];state.votes=[];state.selectedVote=null;
    $("username").value=state.username;show("setup-screen");
  }
  $("username").value=state.username;
  $("create-room").addEventListener("click",createRoom);
  $("join-room").addEventListener("click",joinRoom);
  $("start-game").addEventListener("click",startGame);
  $("submit-answer").addEventListener("click",submitAnswer);
  $("cast-vote").addEventListener("click",castVote);
  $("next-round").addEventListener("click",nextRound);
  $("leave-lobby").addEventListener("click",leaveRoom);
  $("back-home").addEventListener("click",leaveRoom);
  $("brand-home").addEventListener("click",e=>{e.preventDefault();if(!state.room)show("setup-screen");});
  $("copy-code").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(state.room.code);$("copy-code").textContent="Copied!";}catch{say("lobby-status","Room code: "+state.room.code);}});
  $("room-code").addEventListener("input",e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""));
  if(configured) connect();
  else { $("connection").textContent="Connect Supabase to play online"; $("connection").style.color="#bd6a2e"; }
})();