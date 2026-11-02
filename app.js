(() => {
  const cfg = window.CRAZY_RESPONSES_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT") &&
    cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");
  const $ = id => document.getElementById(id);
  const screens = ["setup-screen","browse-screen","weekly-screen","lobby-screen","game-screen","vote-screen","results-screen","final-screen"];
  const state = {
    client:null, userId:localStorage.getItem("cr-user-id") || crypto.randomUUID(),
    username:localStorage.getItem("cr-username") || "", room:null, players:[], submissions:[], votes:[],
    channel:null, timer:null, refreshing:false, refreshAgain:false, readySending:false, votingOrderKey:"", votingOrder:[]
  };
  localStorage.setItem("cr-user-id",state.userId);
  const say = (id,msg) => { if($(id)) $(id).textContent = msg || ""; };
  const show = id => screens.forEach(s => $(s).classList.toggle("hidden",s!==id));
  const isHost = () => !!state.room && state.room.host_id === state.userId;
  const activePlayers = () => state.players.filter(p=>!p.is_spectator);
  const currentSubs = () => state.submissions.filter(s=>s.match_number===state.room.match_number && s.round_number===state.room.round_number);
  const currentVotes = () => state.votes.filter(v=>v.match_number===state.room.match_number && v.round_number===state.room.round_number);
  const myPlayer = () => state.players.find(p=>p.user_id===state.userId);
  const esc = s => String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const shuffle = a => [...a].sort(()=>Math.random()-.5);
  const randomCode = () => Math.random().toString(36).slice(2,8).toUpperCase();
  const db = () => state.client;

  const WORDS = {
    places:["refrigerator","school locker","dentist's office","submarine","haunted house","vending machine","museum","bus stop","gym locker","hotel room","spaceship","library","pet store","principal's office"],
    events:["wedding","job interview","school assembly","family reunion","birthday party","funeral","science fair","talent show","first date","team meeting","graduation ceremony"],
    relatives:["uncle","grandma","cousin","older sibling","stepdad","aunt","grandpa","little brother","mother-in-law","weird cousin"],
    plural:["pigeons","garden gnomes","raccoons","goldfish","traffic cones","potatoes","aliens","squirrels","rubber ducks","skeletons","feral cats"],
    jobs:["dentist","plumber","lifeguard","wizard","mail carrier","bus driver","teacher","chef","mechanic","security guard","space explorer","zookeeper"],
    activities:["learning to juggle","going grocery shopping","building a treehouse","taking a driving test","walking the dog","doing taxes","visiting the dentist","trying to relax","moving house","joining a gym"],
    foods:["pizza","sandwich","birthday cake","smoothie","taco","soup","hamburger","cupcake","pancake","spaghetti dinner"],
    topics:["competitive spoon collecting","the history of socks","angry houseplants","haunted shopping carts","professional nap-taking","the secret lives of lamps","extremely slow racing","underwater gardening"],
    verbs:["fold a fitted sheet","apologize to a toaster","parallel park a shopping cart","speak fluent dolphin","organize a raccoon wedding","defeat a sentient vacuum","make eye contact with a goose","assemble furniture without instructions"],
    objects:["microwave","left shoe","ceiling fan","toaster","remote control","backpack","garden hose","desk lamp","laundry basket",],
    actions:["whispering suspicious advice","singing the national anthem","doing an awkward dance","making tiny sandwiches","plotting world domination","reciting tax law","practicing dramatic exits"],
    problems:["the missing socks","the weird smell in the elevator","the office coffee shortage","the moon being too bright","the disappearance of all spoons","the neighborhood goose problem"],
    people:["your future in-laws","the school principal","a famous actor","the queen of the moon","your dentist","an alien ambassador","the world's strictest librarian"],
    things:["a broken shopping cart","a suspiciously large sandwich","a haunted printer","a bucket of glitter","a very confident pigeon","a malfunctioning robot","a bicycle nobody can see"]
  };
  const TEMPLATES = [
    ["mixed",w=>`The most suspicious thing to find in a ${w.places} is ____.`],
    ["mixed",w=>`The weirdest thing to hear during a ${w.events} is ____.`],
    ["comedy",w=>`My ${w.relatives} has a secret talent for ____.`],
    ["chaotic",w=>`If ${w.plural} ran the world, the first new law would ban ____.`],
    ["comedy",w=>`The worst possible name for a ${w.jobs} is ____.`],
    ["mixed",w=>`Nobody warned me that ${w.activities} would involve ____.`],
    ["comedy",w=>`The secret ingredient in a truly terrible ${w.foods} is ____.`],
    ["chaotic",w=>`A documentary about ${w.topics} would be ruined by ____.`],
    ["mixed",w=>`The first thing a robot should learn is how to ____.`],
    ["chaotic",w=>`At exactly 3 a.m., my ${w.objects} started ____.`],
    ["chaotic",w=>`The government has finally admitted that ____ caused ${w.problems}.`],
    ["comedy",w=>`The worst thing to say while meeting ${w.people} is ____.`],
    ["mixed",w=>`A new holiday should celebrate ____.`],
    ["chaotic",w=>`The instruction manual for ${w.things} should begin with ____.`],
    ["comedy",w=>`My autobiography would be titled "____."`],
    ["mixed",w=>`The only thing more confusing than ${w.things} is ____.`],
    ["chaotic",w=>`If aliens visited Earth, the first thing they would misunderstand is ____.`],
    ["comedy",w=>`The official mascot of a ${w.places} should be ____.`],
    ["mixed",w=>`The fastest way to ruin a perfectly normal ${w.events} is ____.`],
    ["chaotic",w=>`Scientists are now warning everyone to stay away from ____.`],
    ["comedy",w=>`The worst excuse for being late to a ${w.events} is ____.`],
    ["mixed",w=>`Every family has one person who thinks ____ is a normal thing to do.`],
    ["chaotic",w=>`The next Olympic sport should be ____.`],
    ["comedy",w=>`A five-star review of my cooking would probably mention ____.`],
    ["mixed",w=>`The one thing you should never put in a school announcement is ____.`],
    ["chaotic",w=>`The world's least qualified superhero is powered by ____.`],
    ["comedy",w=>`The most awkward sentence to say on a first date is ____.`],
    ["mixed",w=>`The one thing missing from a perfect vacation is ____.`],
    ["chaotic",w=>`My personal army of tiny ____ is ready for battle.`],
    ["comedy",w=>`The real reason the meeting could have been an email was ____.`],
    ["chaotic",w=>`The most dangerous duo in history is a ${w.jobs} and a ${w.jobs}; their weakness is ____.`],
    ["chaotic",w=>`The secret treaty between ${w.plural} and ${w.plural} forbids ____.`],
    ["mixed",w=>`The perfect hiding place for ${w.things} is inside ____.`],
    ["comedy",w=>`The strange thing my ${w.relatives} insists is true about ${w.things} is ____.`],
    ["mixed",w=>`The only way to survive a ${w.events} hosted by my ${w.relatives} is ____.`],
    ["chaotic",w=>`A ${w.foods} restaurant run by ${w.plural} would specialize in ____.`],
    ["mixed",w=>`The next big invention will combine ${w.objects} technology with ____.`],
    ["comedy",w=>`A ${w.jobs} should never bring ${w.things} to ____.`],
    ["chaotic",w=>`The strangest law in a town full of ${w.plural} would require everyone to ____.`],
    ["chaotic",w=>`The annual competition between ${w.plural} and ${w.plural} is judged by ____.`],
    ["comedy",w=>`The worst possible theme for a ${w.events} is ____.`],
    ["mixed",w=>`If ${w.plural} became famous, their manager would make them ____.`],
    ["chaotic",w=>`The new safety warning says never to ____.`],
    ["mixed",w=>`A ${w.things} is no match for a ${w.things} unless ____.`],
    ["comedy",w=>`The only thing that can stop a ${w.jobs} armed with a ${w.objects} is ____.`]
  ];
  const pick = a => a[Math.floor(Math.random()*a.length)];
  function makePrompt(){
    const style=pick(["mixed","chaotic","comedy"]);
    const eligible=TEMPLATES.filter(t=>t[0]===style || (style==="mixed"));
    const template=pick(eligible);
    const words={}; Object.keys(WORDS).forEach(k=>words[k]=pick(WORDS[k]));
    return template[1](words);
  }
  async function reserveUniquePrompt(){
    for(let i=0;i<160;i++){
      const prompt=makePrompt();
      const key=prompt.toLocaleLowerCase().replace(/\s+/g," ").trim();
      const {error}=await db().from("prompt_history").insert({prompt_key:key,prompt_text:prompt});
      if(!error)return {prompt,key};
      if(error.code!=="23505")throw error;
    }
    throw new Error("I couldn't find an unused prompt. Please try again in a moment.");
  }

  function connect(){
    if(!configured||!window.supabase){$("connection").textContent="Setup needed";return false;}
    if(!state.client)state.client=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    $("connection").textContent="Connected";return true;
  }
  async function savePlayer(){
    const name=$("username").value.trim().replace(/\s+/g," ");
    if(name.length<2||name.length>18)throw new Error("Choose a username with 2–18 characters.");
    state.username=name;localStorage.setItem("cr-username",name);
  }
  async function createRoom(){
    try{
      await savePlayer();if(!connect())throw new Error("Add your Supabase settings to config.js first.");
      const maxPlayers=Number($("create-capacity").value),isPublic=$("create-visibility").value==="true";
      const {data:room,error}=await db().from("rooms").insert({code:randomCode(),host_id:state.userId,status:"lobby",round_number:0,match_number:1,is_public:isPublic,max_players:maxPlayers}).select().single();
      if(error)throw error;
      const {error:playerError}=await db().from("players").insert({room_id:room.id,user_id:state.userId,username:state.username,is_host:true,score:0,is_spectator:false,round_ready:false});
      if(playerError)throw playerError;
      state.room=room;await enterRoom();
    }catch(e){say("setup-error",e.message||"Couldn't create the room.");}
  }
  async function joinRoomByCode(){
    try{
      await savePlayer();if(!connect())throw new Error("Add your Supabase settings to config.js first.");
      const code=$("room-code").value.trim().toUpperCase();if(code.length!==6)throw new Error("Enter the 6-character room code.");
      const {data:room,error}=await db().from("rooms").select("*").eq("code",code).maybeSingle();
      if(error)throw error;if(!room)throw new Error("That room code wasn't found.");
      await joinRoomObject(room);
    }catch(e){say("setup-error",e.message||"Couldn't join the room.");}
  }
  async function joinRoomObject(room){
    await savePlayer();
    const {error}=await db().rpc("join_crazy_room",{p_room_id:room.id,p_user_id:state.userId,p_username:state.username});
    if(error)throw error;
    state.room=room;await enterRoom();
  }
  async function enterRoom(){
    show("lobby-screen");
    if(state.channel)await db().removeChannel(state.channel);
    state.channel=db().channel("room-"+state.room.id)
      .on("postgres_changes",{event:"*",schema:"public",table:"players",filter:"room_id=eq."+state.room.id},refresh)
      .on("postgres_changes",{event:"*",schema:"public",table:"rooms",filter:"id=eq."+state.room.id},refresh)
      .on("postgres_changes",{event:"*",schema:"public",table:"submissions",filter:"room_id=eq."+state.room.id},refresh)
      .on("postgres_changes",{event:"*",schema:"public",table:"votes",filter:"room_id=eq."+state.room.id},refresh)
      .subscribe();
    await refresh();
  }
  async function refresh(){
    if(!state.room)return;
    if(state.refreshing){state.refreshAgain=true;return;}
    state.refreshing=true;
    try{
      const [r,p,s,v]=await Promise.all([
        db().from("rooms").select("*").eq("id",state.room.id).single(),
        db().from("players").select("*").eq("room_id",state.room.id).order("created_at"),
        db().from("submissions").select("*").eq("room_id",state.room.id),
        db().from("votes").select("*").eq("room_id",state.room.id)
      ]);
      if(r.error||p.error||s.error||v.error)throw r.error||p.error||s.error||v.error;
      state.room=r.data;state.players=p.data;state.submissions=s.data;state.votes=v.data;
      if(state.room.status==="lobby")renderLobby();
      else if(state.room.status==="answering")renderGame();
      else if(state.room.status==="voting")renderVote();
      else if(state.room.status==="results")renderResults();
      else if(state.room.status==="finished")renderFinal();
    }catch(e){console.error(e);}
    finally{state.refreshing=false;if(state.refreshAgain){state.refreshAgain=false;refresh();}}
  }
  function renderLobby(){
    show("lobby-screen");$("display-room-code").textContent=state.room.code;
    $("player-count").textContent=`${state.players.length} / ${state.room.max_players}`;
    $("room-visibility-label").textContent=state.room.is_public?"PUBLIC ROOM":"PRIVATE ROOM";
    $("player-list").innerHTML=state.players.map(p=>`<li><span class="player-name"><span class="avatar">${esc(p.username.slice(0,1).toUpperCase())}</span>${esc(p.username)} ${p.is_host?'<span class="host-tag">HOST</span>':""} ${p.is_spectator?'<span class="spectator-tag">SPECTATING</span>':""}</span><span class="muted small">${p.user_id===state.userId?"YOU":""}</span></li>`).join("");
    $("host-controls").classList.toggle("hidden",!isHost());$("host-settings").classList.toggle("hidden",!isHost());
    $("start-game").disabled=!isHost()||state.players.length<3||state.players.length>state.room.max_players;
    $("room-visibility").value=String(state.room.is_public);$("room-capacity").value=String(state.room.max_players);
    say("lobby-status",state.players.length<3?"Waiting for at least 3 players…":isHost()?"Room ready. Change settings or start when everyone is here.":"Waiting for the host to start.");
  }
  async function saveRoomSettings(){
    const max=Number($("room-capacity").value),isPublic=$("room-visibility").value==="true";
    if(!isHost())return;
    if(max<state.players.length){say("settings-status","Player limit cannot be lower than the current player count.");return;}
    const {error}=await db().from("rooms").update({max_players:max,is_public:isPublic}).eq("id",state.room.id).eq("host_id",state.userId);
    say("settings-status",error?error.message:"Room settings saved.");await refresh();
  }
  async function startGame(){
    if(!isHost()||state.players.length<3||state.players.length>state.room.max_players)return;
    try{
      const {prompt,key}=await reserveUniquePrompt();
      await db().from("players").update({is_spectator:false,round_ready:false,score:0}).eq("room_id",state.room.id);
      const {error}=await db().from("rooms").update({status:"answering",round_number:1,prompt,prompt_key:key,round_started_at:new Date().toISOString(),response_started_at:null,response_deadline_at:null}).eq("id",state.room.id);
      if(error)throw error;await refresh();
    }catch(e){alert(e.message||"Couldn't start the game.");}
  }
  function mySubmission(){return currentSubs().find(s=>s.user_id===state.userId);}
  async function markReady(){
    const me=myPlayer();if(!me||me.is_spectator||me.round_ready||state.readySending)return;
    state.readySending=true;
    try{
      await db().from("players").update({round_ready:true}).eq("id",me.id).eq("round_ready",false);
      await db().rpc("try_start_response_timer",{p_room_id:state.room.id});
      await refresh();
    }finally{state.readySending=false;}
  }
  function renderGame(){
    show("game-screen");const me=myPlayer(),spectator=!me||me.is_spectator;
    $("round-label").textContent=`ROUND ${state.room.round_number} / 5`;
    $("prompt-text").textContent=state.room.prompt||"Prompt loading…";
    const mine=mySubmission(),subs=currentSubs(),active=activePlayers(),submitted=subs.length;
    const deadline=state.room.response_deadline_at?new Date(state.room.response_deadline_at).getTime():0;
    const expired=deadline>0&&Date.now()>=deadline;
    $("answer-area").classList.toggle("hidden",spectator||!!mine||expired);
    $("submitted-message").classList.toggle("hidden",spectator||!mine);
    $("spectator-message").classList.toggle("hidden",!spectator);
    $("submission-count").textContent=`${submitted} / ${active.length} submitted`;
    $("submission-progress").firstElementChild.style.width=(active.length?Math.min(100,submitted/active.length*100):0)+"%";
    if(spectator)say("game-status","You're spectating. You'll join when the next round begins.");
    else if(!state.room.response_started_at)say("game-status","Waiting for every active player to reach the response screen…");
    else if(expired)say("game-status","Time is up. Moving to voting…");
    else say("game-status",submitted>=active.length?"All answers are in! Moving to voting…":"Answers stay hidden until voting begins.");
    if(!spectator&&!me.round_ready)markReady();
    updateTimerLabel();
    if(deadline&&expired)advanceToVoting();
    if(deadline&&subs.length>=active.length)advanceToVoting();
    startTicker();
  }
  function updateTimerLabel(){
    const me=myPlayer();
    if(me?.is_spectator){say("timer-label","Spectating this round");return;}
    if(!state.room.response_deadline_at){say("timer-label","Waiting for everyone…");return;}
    const left=Math.max(0,Math.ceil((new Date(state.room.response_deadline_at).getTime()-Date.now())/1000));
    say("timer-label",left>0?`⏱ ${left}s remaining`:"⏱ Time's up");
  }
  function startTicker(){if(state.timer)return;state.timer=setInterval(async()=>{
    if(!state.room)return;
    if(state.room.status==="answering"){
      updateTimerLabel();
      const deadline=state.room.response_deadline_at?new Date(state.room.response_deadline_at).getTime():0;
      if(deadline&&Date.now()>=deadline)await advanceToVoting();
    }
  },300);}
  async function submitAnswer(){
    const me=myPlayer();if(!me||me.is_spectator)return;
    const answer=$("answer-input").value.trim();if(answer.length<2){say("game-status","Write an answer before submitting.");return;}
    const deadline=state.room.response_deadline_at?new Date(state.room.response_deadline_at).getTime():0;
    if(!deadline||Date.now()>=deadline){say("game-status","The response timer has ended.");await advanceToVoting();return;}
    const {error}=await db().from("submissions").insert({room_id:state.room.id,round_number:state.room.round_number,match_number:state.room.match_number,user_id:state.userId,author_name:state.username,answer});
    if(error)say("game-status",error.message);else $("answer-input").value="";
    await refresh();
    if(currentSubs().length>=activePlayers().length)await advanceToVoting();
  }
  async function advanceToVoting(){
    if(!state.room||state.room.status!=="answering")return;
    const {data,error}=await db().rpc("advance_to_voting_if_ready",{p_room_id:state.room.id});
    if(error)console.error(error);else if(data)await refresh();
  }
  function renderVote(){
    show("vote-screen");$("vote-round-label").textContent=`ROUND ${state.room.round_number} / 5`;
    const me=myPlayer(),spectator=!me||me.is_spectator,subs=currentSubs(),votes=currentVotes(),already=votes.some(v=>v.user_id===state.userId);
    const key=`${state.room.match_number}-${state.room.round_number}`;
    if(state.votingOrderKey!==key){state.votingOrderKey=key;state.votingOrder=shuffle(subs);}
    $("answer-options").innerHTML=state.votingOrder.map(s=>`<button class="answer-option ${state.selectedVote===s.id?"selected":""}" data-id="${s.id}" ${s.user_id===state.userId||already||spectator?"disabled":""}>${esc(s.answer)}</button>`).join("");
    document.querySelectorAll(".answer-option").forEach(b=>b.addEventListener("click",()=>{state.selectedVote=b.dataset.id;renderVote();}));
    $("cast-vote").disabled=!state.selectedVote||already||spectator;$("cast-vote").textContent=already?"Vote submitted":spectator?"Spectating":"Cast my vote";
    say("vote-status",spectator?"You're spectating. You'll join next round.":already?"Your vote has been recorded.":"Choose your favorite answer. You cannot vote for your own.");
    db().rpc("advance_to_results_if_done",{p_room_id:state.room.id}).then(({data,error})=>{if(error)console.error(error);else if(data)refresh();}).catch(console.error);
  }
  async function castVote(){
    if(!state.selectedVote)return;
    const {error}=await db().rpc("cast_crazy_vote",{p_room_id:state.room.id,p_user_id:state.userId,p_submission_id:state.selectedVote});
    if(error)say("vote-status",error.message);state.selectedVote=null;await refresh();
    await db().rpc("advance_to_results_if_done",{p_room_id:state.room.id});await refresh();
  }
  function scoreThisRound(){
    const subs=currentSubs(),votes=currentVotes(),counts={};votes.forEach(v=>counts[v.submission_id]=(counts[v.submission_id]||0)+1);
    return subs.map(s=>({...s,vote_count:counts[s.id]||0})).sort((a,b)=>b.vote_count-a.vote_count);
  }
  function renderResults(){
    show("results-screen");const ranking=scoreThisRound(),winner=ranking[0];
    $("round-winner-title").textContent=winner&&winner.vote_count?"The funniest answer was…":"No votes this round";
    $("winning-answer").textContent=winner&&winner.vote_count?`“${winner.answer}”`:"No votes were cast.";
    $("winning-player").textContent=winner&&winner.vote_count?`${winner.author_name||"A player"} · ${winner.vote_count} vote(s)`:"";
    $("results-round").textContent=`Round ${state.room.round_number} of 5`;
    const players=[...state.players].sort((a,b)=>b.score-a.score);
    $("leaderboard").innerHTML=players.map((p,i)=>`<li><span class="player-name"><span class="rank">${i+1}.</span>${esc(p.username)} ${p.is_spectator?'<span class="spectator-tag">SPECTATING</span>':""}</span><span class="score">${p.score} votes</span></li>`).join("");
    $("next-round").classList.toggle("hidden",!isHost());say("results-status",isHost()?"Click Next Round when everyone has seen the results.":"Waiting for the host to continue.");
  }
  async function nextRound(){
    if(!isHost())return;
    if(state.room.round_number>=5){const {error}=await db().from("rooms").update({status:"finished"}).eq("id",state.room.id);if(error)alert(error.message);await refresh();return;}
    try{
      const {prompt,key}=await reserveUniquePrompt();
      await db().from("players").update({is_spectator:false,round_ready:false}).eq("room_id",state.room.id);
      const {error}=await db().from("rooms").update({status:"answering",round_number:state.room.round_number+1,prompt,prompt_key:key,round_started_at:new Date().toISOString(),response_started_at:null,response_deadline_at:null}).eq("id",state.room.id);
      if(error)throw error;state.votingOrderKey="";await refresh();
    }catch(e){alert(e.message||"Couldn't start the next round.");}
  }
  function renderFinal(){
    show("final-screen");const ranking=[...state.players].sort((a,b)=>b.score-a.score);
    $("final-winner").textContent=ranking.length?`${ranking[0].username} received ${ranking[0].score} vote(s)!`:"Game finished.";
    $("final-leaderboard").innerHTML=ranking.map((p,i)=>`<li><span class="player-name"><span class="rank">${i+1}.</span>${esc(p.username)}</span><span class="score">${p.score} votes</span></li>`).join("");
    $("play-again").classList.toggle("hidden",!isHost());say("final-status",isHost()?"Start another match with everyone still in this room.":"Waiting for the host to start another match.");
  }
  async function playAgain(){
    if(!isHost())return;
    const {error:pe}=await db().from("players").update({score:0,is_spectator:false,round_ready:false}).eq("room_id",state.room.id);
    if(pe){alert(pe.message);return;}
    const {error}=await db().from("rooms").update({status:"lobby",round_number:0,match_number:state.room.match_number+1,prompt:null,prompt_key:null,response_started_at:null,response_deadline_at:null}).eq("id",state.room.id);
    if(error)alert(error.message);else await refresh();
  }
  async function browseRooms(){
    try{
      if(!connect())throw new Error("Connect Supabase first.");show("browse-screen");say("browse-status","Loading public rooms…");
      const {data:rooms,error}=await db().from("rooms").select("*").eq("is_public",true).in("status",["lobby","answering","voting","results"]).order("created_at",{ascending:false}).limit(50);
      if(error)throw error;
      if(!rooms.length){$("public-room-list").innerHTML='<p class="muted small">No public rooms right now. Create one and invite people!</p>';say("browse-status","");return;}
      const ids=rooms.map(r=>r.id);const {data:players,error:pe}=await db().from("players").select("room_id,username,is_host,is_spectator").in("room_id",ids);if(pe)throw pe;
      $("public-room-list").innerHTML=rooms.map(r=>{
        const members=players.filter(p=>p.room_id===r.id),host=members.find(p=>p.is_host)?.username||"Room host";
        const status=r.status==="lobby"?"Waiting in lobby":r.status==="answering"?"Writing answers":r.status==="voting"?"Voting":"Viewing results";
        const full=members.length>=r.max_players;
        return `<div class="room-card"><div><h3>${esc(host)}'s room</h3><p>${status} · Round ${r.round_number||0}/5 · ${members.length}/${r.max_players} players</p><p>${full?"Room full":"Late joiners spectate until next round"}</p></div><button class="secondary" data-room="${r.id}" ${full?"disabled":""}>${full?"Full":"Join"}</button></div>`;
      }).join("");
      document.querySelectorAll("[data-room]").forEach(b=>b.addEventListener("click",async()=>{
        try{const room=rooms.find(r=>r.id===b.dataset.room);await joinRoomObject(room);}catch(e){say("browse-status",e.message);}
      }));say("browse-status","");
    }catch(e){say("browse-status",e.message||"Couldn't load public rooms.");}
  }
  async function weeklyLeaderboard(){
    try{
      if(!connect())throw new Error("Connect Supabase first.");show("weekly-screen");say("weekly-status","Loading this week's votes…");
      const {data,error}=await db().from("weekly_leaderboard").select("user_id,username,points").order("points",{ascending:false}).limit(100);
      if(error)throw error;
      $("weekly-list").innerHTML=data.length?data.map((p,i)=>`<li><span class="player-name"><span class="rank">${i+1}.</span>${esc(p.username)}</span><span class="score">${p.points} pts</span></li>`).join(""):'<li class="muted">No votes have been received this week yet.</li>';
      say("weekly-status","One point for every vote received. Rankings reset Monday (UTC).");
    }catch(e){say("weekly-status",e.message||"Couldn't load the weekly leaderboard.");}
  }
  async function leaveRoom(){
    if(state.timer){clearInterval(state.timer);state.timer=null;}
    if(state.channel)await db().removeChannel(state.channel);
    if(state.room)await db().from("players").delete().eq("room_id",state.room.id).eq("user_id",state.userId);
    state.room=null;state.players=[];state.submissions=[];state.votes=[];state.selectedVote=null;state.votingOrderKey="";
    $("username").value=state.username;show("setup-screen");
  }
  function setTheme(theme){document.documentElement.dataset.theme=theme;localStorage.setItem("cr-theme",theme);$("theme-toggle").textContent=theme==="dark"?"☀ Light":"☾ Dark";}
  $("username").value=state.username;setTheme(localStorage.getItem("cr-theme")||"light");
  $("create-room").addEventListener("click",createRoom);$("join-room").addEventListener("click",joinRoomByCode);
  $("start-game").addEventListener("click",startGame);$("submit-answer").addEventListener("click",submitAnswer);
  $("cast-vote").addEventListener("click",castVote);$("next-round").addEventListener("click",nextRound);
  $("play-again").addEventListener("click",playAgain);$("leave-lobby").addEventListener("click",leaveRoom);$("leave-final").addEventListener("click",leaveRoom);
  $("save-room-settings").addEventListener("click",saveRoomSettings);$("copy-code").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(state.room.code);$("copy-code").textContent="Copied!";}catch{say("lobby-status","Room code: "+state.room.code);}});
  $("room-code").addEventListener("input",e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""));
  $("browse-rooms").addEventListener("click",browseRooms);$("refresh-rooms").addEventListener("click",browseRooms);$("back-from-browse").addEventListener("click",()=>show("setup-screen"));
  $("open-weekly").addEventListener("click",weeklyLeaderboard);$("back-from-weekly").addEventListener("click",()=>show("setup-screen"));
  $("theme-toggle").addEventListener("click",()=>setTheme(document.documentElement.dataset.theme==="dark"?"light":"dark"));
  $("brand-home").addEventListener("click",e=>{e.preventDefault();if(!state.room)show("setup-screen");});
  if(configured)connect();else{$("connection").textContent="Connect Supabase to play online";}
})();
