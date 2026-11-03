(() => {
"use strict";
const cfg=window.CRAZY_RESPONSES_CONFIG||{};
const configured=!!(cfg.SUPABASE_URL&&cfg.SUPABASE_ANON_KEY&&!String(cfg.SUPABASE_URL).includes("YOUR-"));
const $=id=>document.getElementById(id);
const screens=["setup-screen","browse-screen","weekly-screen","lobby-screen","game-screen","vote-screen","results-screen","final-screen"];
const state={client:null,userId:localStorage.getItem("cr-user-id")||crypto.randomUUID(),username:localStorage.getItem("cr-username")||"",room:null,players:[],submissions:[],votes:[],ready:[],channel:null,selectedVote:null,refreshing:false,roomPoll:null,tick:null,readySent:null,transitioning:false,votingCheck:false};
localStorage.setItem("cr-user-id",state.userId);
const say=(id,msg)=>{if($(id))$(id).textContent=msg||"";};
const show=id=>screens.forEach(s=>$(s).classList.toggle("hidden",s!==id));
const isHost=()=>!!state.room&&state.room.host_id===state.userId;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const db=()=>state.client;
const currentRound=()=>Number(state.room?.round_number||0);
const activePlayers=()=>state.players.filter(p=>(p.joined_round||1)<=currentRound());
const me=()=>state.players.find(p=>p.user_id===state.userId);
const mine=()=>state.submissions.find(s=>s.user_id===state.userId&&s.round_number===currentRound());
const shuffle=a=>[...a].sort(()=>Math.random()-.5);
const code=()=>Math.random().toString(36).slice(2,8).toUpperCase();
const utcWeek=()=>{const d=new Date();const day=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-day);return d.toISOString().slice(0,10);};

const promptTemplates=[
["mixed","The most suspicious thing to find in a lunchbox is {x}."],
["mixed","My family has one unbreakable rule: never trust {x}."],
["mixed","The real reason the power went out was {x}."],
["mixed","The worst possible thing to say during a job interview is {x}."],
["mixed","The museum's newest exhibit is just {x}."],
["mixed","I knew the camping trip was doomed when someone unpacked {x}."],
["mixed","The secret ingredient in the world's strangest soup is {x}."],
["mixed","The first thing aliens noticed about Earth was {x}."],
["mixed","The school announced a surprise test about {x}."],
["mixed","Nothing says 'welcome home' quite like {x}."],
["chaotic","The mayor has officially declared {x} illegal."],
["chaotic","Scientists accidentally created a machine that turns everything into {x}."],
["chaotic","The emergency broadcast warned everyone to hide from {x}."],
["chaotic","The new national holiday celebrates {x}."],
["chaotic","The final boss of adulthood is actually {x}."],
["chaotic","The secret society meets every Thursday to discuss {x}."],
["chaotic","The moon landing was delayed because NASA forgot {x}."],
["chaotic","The only acceptable offering to the ancient volcano is {x}."],
["chaotic","A tiny wizard appeared and demanded {x}."],
["chaotic","The world's least practical superhero is powered by {x}."],
["comedy","The worst slogan for a dentist's office is {x}."],
["comedy","My autobiography will be titled 'A Lifetime of {x}'."],
["comedy","The customer complaint simply said, 'There was {x} in my soup.'" ],
["comedy","The secret to looking confident is carrying {x}."],
["comedy","The new dating app matches people based on their love of {x}."],
["comedy","The worst thing to hear from your doctor is 'You have {x}.'" ],
["comedy","My new business idea is selling {x} to people who already have everything."],
["comedy","The world's most awkward icebreaker is 'Tell us about {x}.'" ],
["comedy","The motivational speaker's only advice was {x}."],
["comedy","The restaurant's one-star review complained about {x}."]
];
const promptFillers=[
"an emotionally unstable toaster","a suspicious amount of glitter","three raccoons in a trench coat","a very confident potato","grandpa's emergency kazoo","a tiny horse with big plans","a haunted pool noodle","an unnecessary amount of mayonnaise","a confused wizard","a taxidermy flamingo","a bucket of mysterious buttons","a goose with a personal vendetta","an inflatable courtroom","a sandwich with trust issues","a very loud spoon","a family-sized jar of pickles","a self-aware traffic cone","a deeply offended penguin","a disco ball full of bees","a motivational cabbage","a suspiciously warm snowman","a bagpipe orchestra","a time-traveling dentist","a dramatic folding chair","a million tiny hats","a robot with stage fright","a cursed birthday cake","a professional nap consultant","a suitcase full of rubber ducks","an extremely judgmental squirrel","a haunted vending machine","a glitter-covered lawn mower","a very polite dragon","a soap opera about potatoes","an army of tiny librarians","a suspiciously elegant shrimp","a medieval leaf blower","a nervous astronaut","a sentient bowl of cereal","a pair of tap-dancing boots","a wizard's unpaid parking ticket","a golden retriever in a business suit","a very complicated handshake","a mysterious cheese wheel","a choir of angry frogs","a breakdancing scarecrow","a tiny submarine full of spaghetti","a haunted karaoke machine","an aggressively friendly cactus","a seven-foot birthday candle"
];
function makePrompt(){
  const [style,template]=promptTemplates[Math.floor(Math.random()*promptTemplates.length)];
  const filler=promptFillers[Math.floor(Math.random()*promptFillers.length)];
  return {style,prompt:template.replace("{x}",filler)};
}
async function uniquePrompt(){
  for(let i=0;i<100;i++){
    const candidate=makePrompt();
    const normalized=candidate.prompt.toLocaleLowerCase().replace(/\s+/g," ").trim();
    const {error}=await db().from("used_prompts").insert({normalized_prompt:normalized,prompt:candidate.prompt,style:candidate.style});
    if(!error)return candidate.prompt;
    if(error.code!=="23505")throw error;
  }
  throw new Error("Couldn't find a new prompt. Please try starting the round again.");
}
function connect(){
  if(!configured||!window.supabase){$("connection").textContent="Setup needed";return false;}
  if(!state.client)state.client=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
  $("connection").textContent="Connected";return true;
}
async function saveName(){
  const name=$("username").value.trim().replace(/\s+/g," ");
  if(name.length<2||name.length>18)throw new Error("Username must be 2–18 characters.");
  state.username=name;localStorage.setItem("cr-username",name);
}
function resetRoomState(){
  state.players=[];state.submissions=[];state.votes=[];state.ready=[];state.selectedVote=null;state.readySent=null;state.transitioning=false;
}
async function createRoom(){
 try{
  await saveName();if(!connect())throw new Error("Supabase settings are missing from config.js.");
  const max=Number($("new-limit").value),visibility=$("new-visibility").value;
  const {data:room,error}=await db().from("rooms").insert({code:code(),host_id:state.userId,status:"lobby",round_number:0,is_public:visibility==="public",max_players:max}).select().single();
  if(error)throw error;state.room=room;
  const {error:pe}=await db().from("players").insert({room_id:room.id,user_id:state.userId,username:state.username,is_host:true,score:0,joined_round:1});
  if(pe)throw pe;await enterRoom();
 }catch(e){say("setup-error",e.message||"Couldn't create room.");}
}
async function joinByCode(){
 try{
  await saveName();if(!connect())throw new Error("Supabase settings are missing from config.js.");
  const codeValue=$("room-code").value.trim().toUpperCase();if(codeValue.length!==6)throw new Error("Enter the 6-character room code.");
  const {data:room,error}=await db().from("rooms").select("*").eq("code",codeValue).maybeSingle();if(error)throw error;
  if(!room)throw new Error("Room not found.");await joinRoomRecord(room);
 }catch(e){say("setup-error",e.message||"Couldn't join room.");}
}
async function joinRoomRecord(room){
 await db().rpc("cleanup_crazy_rooms");
 const {data:freshRoom,error:roomError}=await db().from("rooms").select("*").eq("id",room.id).maybeSingle();
 if(roomError)throw roomError;
 if(!freshRoom)throw new Error("That room has expired because everyone left.");
 room=freshRoom;
 const {data:members,error}=await db().from("players").select("*").eq("room_id",room.id);if(error)throw error;
 const existing=members.find(p=>p.user_id===state.userId);
 if(existing){state.room=room;await enterRoom();return;}
 if(members.length>=room.max_players)throw new Error("That room is full.");
 const joinedRound=room.status==="lobby"?1:Number(room.round_number||0)+1;
 const {error:insertError}=await db().from("players").insert({room_id:room.id,user_id:state.userId,username:state.username,is_host:false,score:0,joined_round:joinedRound});
 if(insertError)throw insertError;
 state.room=room;await enterRoom();
}
async function enterRoom(){
 if(state.channel)await db().removeChannel(state.channel);
 state.readySent=null;state.channel=db().channel("cr-room-"+state.room.id)
 .on("postgres_changes",{event:"*",schema:"public",table:"players",filter:"room_id=eq."+state.room.id},refresh)
 .on("postgres_changes",{event:"*",schema:"public",table:"rooms",filter:"id=eq."+state.room.id},refresh)
 .on("postgres_changes",{event:"*",schema:"public",table:"submissions",filter:"room_id=eq."+state.room.id},refresh)
 .on("postgres_changes",{event:"*",schema:"public",table:"votes",filter:"room_id=eq."+state.room.id},refresh)
 .on("postgres_changes",{event:"*",schema:"public",table:"round_ready",filter:"room_id=eq."+state.room.id},refresh)
 .subscribe();
 await heartbeat();
 await refresh();
}
async function heartbeat(){
 if(!state.room||!db())return;
 const {error}=await db().rpc("heartbeat_crazy_player",{p_room_id:state.room.id,p_user_id:state.userId});
 if(error)console.warn("Player heartbeat failed:",error.message);
}
async function cleanupRooms(){
 if(!db())return;
 const {error}=await db().rpc("cleanup_crazy_rooms");
 if(error)console.warn("Room cleanup failed:",error.message);
}
async function ensureVotingDeadline(){
 if(!isHost()||state.room?.status!=="voting"||state.room.voting_deadline_at)return;
 const deadline=new Date(Date.now()+30000).toISOString();
 const {error}=await db().from("rooms").update({voting_deadline_at:deadline}).eq("id",state.room.id).eq("status","voting").is("voting_deadline_at",null);
 if(error)console.warn("Could not start voting timer:",error.message);
 await refresh();
}
async function advanceVotingIfReady(){
 if(!state.room||state.room.status!=="voting"||state.votingCheck)return;
 state.votingCheck=true;
 const {error}=await db().rpc("advance_crazy_vote_if_done",{p_room_id:state.room.id});
 if(error)console.warn("Voting phase check failed:",error.message);
 state.votingCheck=false;
}
function updateVoteTimer(){
 if(!state.room||state.room.status!=="voting")return;
 let timer=$("vote-timer");
 if(!timer){timer=document.createElement("p");timer.id="vote-timer";timer.className="notice";const heading=$("vote-round-label");heading?.parentElement?.insertAdjacentElement("afterend",timer);}
 if(!state.room.voting_deadline_at){timer.textContent="Voting timer is starting…";if(isHost())ensureVotingDeadline();return;}
 const remaining=Math.max(0,Math.ceil((new Date(state.room.voting_deadline_at).getTime()-Date.now())/1000));
 timer.textContent=`Time left to vote: 00:${String(remaining).padStart(2,"0")}`;
 if(remaining===0)advanceVotingIfReady();
}
function installLeaveMatchButton(){
 if($("leave-match-global"))return;
 const button=document.createElement("button");button.id="leave-match-global";button.type="button";button.textContent="Leave match";
 button.style.cssText="position:fixed;right:18px;bottom:18px;z-index:1000;padding:11px 16px;border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--text);font:600 14px 'DM Sans',sans-serif;box-shadow:var(--shadow);cursor:pointer;display:none";
 button.addEventListener("click",async()=>{if(!state.room)return;if(confirm("Leave this match and return to the main menu?"))await leaveRoom();});
 document.body.appendChild(button);
}
function updateLeaveMatchButton(){
 const button=$("leave-match-global");if(!button)return;
 const activeScreen=["game-screen","vote-screen","results-screen","final-screen"].some(id=>!$(id).classList.contains("hidden"));
 button.style.display=state.room&&activeScreen?"block":"none";
}
async function refresh(){
 if(!state.room||state.refreshing)return;state.refreshing=true;
 try{
  const r=await db().from("rooms").select("*").eq("id",state.room.id).single();
  if(r.error)throw r.error;
  const round=Number(r.data.round_number||0);
  const [p,s,v,ready]=await Promise.all([
   db().from("players").select("*").eq("room_id",state.room.id).order("created_at"),
   db().from("submissions").select("*").eq("room_id",state.room.id).eq("round_number",round),
   db().from("votes").select("*").eq("room_id",state.room.id).eq("round_number",round),
   db().from("round_ready").select("*").eq("room_id",state.room.id).eq("round_number",round)
  ]);
  for(const x of [p,s,v,ready])if(x.error)throw x.error;
  state.room=r.data;state.players=p.data;state.submissions=s.data;state.votes=v.data;state.ready=ready.data;
  renderCurrent();
 }catch(e){console.error(e);if($("connection"))$("connection").textContent="Connection issue";}
 finally{state.refreshing=false;}
}
function renderCurrent(){
 const status=state.room.status;
 if(status==="lobby")renderLobby();
 else if(status==="answering")renderGame();
 else if(status==="voting")renderVote();
 else if(status==="results")renderResults();
 else if(status==="finished")renderFinal();
 updateLeaveMatchButton();
}
function renderLobby(){
 show("lobby-screen");$("display-room-code").textContent=state.room.code;
 $("player-count").textContent=`${state.players.length} / ${state.room.max_players}`;
 $("player-list").innerHTML=state.players.map(p=>`<li><span class="player-name"><span class="avatar">${esc(p.username[0].toUpperCase())}</span>${esc(p.username)} ${p.is_host?'<span class="host-tag">HOST</span>':""}</span><span class="muted small">${p.user_id===state.userId?"YOU":""}</span></li>`).join("");
 $("host-controls").classList.toggle("hidden",!isHost());
 if(isHost()){$("room-visibility").value=state.room.is_public?"public":"private";$("room-limit").value=String(state.room.max_players);}
 $("start-game").disabled=!isHost()||state.players.length<3||state.players.length>state.room.max_players;
 say("lobby-status",state.players.length<3?"Need at least 3 players to start.":isHost()?"You're the host. Adjust settings or start when ready.":"Waiting for the host to start.");
 say("room-settings-note",`This room is ${state.room.is_public?"public":"private"}. ${state.players.length}/${state.room.max_players} player slots used.`);
}
async function saveRoomSettings(){
 if(!isHost())return;const limit=Number($("room-limit").value);
 if(limit<state.players.length){say("lobby-status","Player limit cannot be lower than the number of people already in the room.");return;}
 const {error}=await db().from("rooms").update({is_public:$("room-visibility").value==="public",max_players:limit}).eq("id",state.room.id);
 if(error)say("lobby-status",error.message);else await refresh();
}
async function startGame(){
 if(!isHost()||state.players.length<3)return;
 try{
  const prompt=await uniquePrompt();
  await db().from("round_ready").delete().eq("room_id",state.room.id);
  const {error}=await db().from("rooms").update({status:"answering",round_number:1,prompt,round_deadline_at:null,voting_deadline_at:null}).eq("id",state.room.id);
  if(error)throw error;state.readySent=null;await refresh();
 }catch(e){alert(e.message);}
}
async function markReady(){
 if(!state.room||state.room.status!=="answering"||!me()||(me().joined_round||1)>currentRound())return;
 const key=`${state.room.id}:${currentRound()}`;
 if(state.readySent===key||state.ready.some(x=>x.user_id===state.userId))return;
 state.readySent=key;
 const {error}=await db().from("round_ready").upsert({room_id:state.room.id,round_number:currentRound(),user_id:state.userId},{onConflict:"room_id,round_number,user_id",ignoreDuplicates:true});
 if(error){state.readySent=null;console.warn(error);}
 await refresh();
}
async function maybeStartTimer(){
 if(!isHost()||state.room.status!=="answering"||state.room.round_deadline_at)return;
 const active=activePlayers();if(active.length<1)return;
 const readyIds=new Set(state.ready.map(x=>x.user_id));
 if(!active.every(p=>readyIds.has(p.user_id)))return;
 const deadline=new Date(Date.now()+60000).toISOString();
 const {error}=await db().from("rooms").update({round_deadline_at:deadline}).eq("id",state.room.id).eq("status","answering").is("round_deadline_at",null);
 if(error)console.warn(error);await refresh();
}
function renderGame(){
 show("game-screen");$("round-label").textContent=`ROUND ${currentRound()} / 5`;$("prompt-text").textContent=state.room.prompt||"A new prompt is on its way…";
 const player=me(),spectator=!player||(player.joined_round||1)>currentRound(),mineAnswer=mine();
 $("spectator-message").classList.toggle("hidden",!spectator);
 $("answer-area").classList.toggle("hidden",spectator||!!mineAnswer);
 $("submitted-message").classList.toggle("hidden",spectator||!mineAnswer);
 const active=activePlayers(),submitted=state.submissions.length,readyIds=new Set(state.ready.map(x=>x.user_id));
 $("submission-count").textContent=`${submitted} / ${active.length} submitted`;
 $("submission-progress-fill").style.width=(active.length?submitted/active.length*100:0)+"%";
 if(spectator)say("game-status","You're spectating. You'll become an active player next round.");
 else if(!state.room.round_deadline_at)say("game-status",`${readyIds.size} / ${active.length} players have reached the response screen. Timer starts when everyone is ready.`);
 else say("game-status",`${submitted} / ${active.length} answers submitted. Unsubmitted players are skipped when time runs out.`);
 if(!spectator)markReady();
 if(isHost()){
  if(active.length&&active.every(p=>state.submissions.some(sub=>sub.user_id===p.user_id)))moveToVoting();
  else maybeStartTimer();
 }
 updateTimer();
}
function updateTimer(){
 if(!state.room||state.room.status!=="answering")return;
 if(!state.room.round_deadline_at){$("timer-label").textContent="Waiting for everyone";return;}
 const remaining=Math.max(0,Math.ceil((new Date(state.room.round_deadline_at).getTime()-Date.now())/1000));
 $("timer-label").textContent=`${String(Math.floor(remaining/60)).padStart(2,"0")}:${String(remaining%60).padStart(2,"0")}`;
 if(remaining===0&&isHost())moveToVoting();
}
async function submitAnswer(){
 if(!me()||(me().joined_round||1)>currentRound())return;
 const answer=$("answer-input").value.trim();if(answer.length<2){say("game-status","Write an answer first.");return;}
 if(state.room.round_deadline_at&&Date.now()>new Date(state.room.round_deadline_at).getTime()){say("game-status","Time is up!");return;}
 const {error}=await db().from("submissions").insert({room_id:state.room.id,round_number:currentRound(),user_id:state.userId,answer});
 if(error)say("game-status",error.message);else $("answer-input").value="";
 await refresh();
}
async function moveToVoting(){
 if(!isHost()||state.room.status!=="answering"||state.transitioning)return;
 const active=activePlayers(),allSubmitted=active.every(p=>state.submissions.some(s=>s.user_id===p.user_id));
 const expired=state.room.round_deadline_at&&Date.now()>=new Date(state.room.round_deadline_at).getTime();
 if(!allSubmitted&&!expired)return;
 state.transitioning=true;
 const {error}=await db().from("rooms").update({status:"voting",round_deadline_at:null,voting_deadline_at:new Date(Date.now()+30000).toISOString()}).eq("id",state.room.id).eq("status","answering");
 state.transitioning=false;if(error)console.error(error);await refresh();
}
function renderVote(){
 show("vote-screen");$("vote-round-label").textContent=`ROUND ${currentRound()} / 5`;
 updateVoteTimer();
 const player=me(),spectator=!player||(player.joined_round||1)>currentRound();
 const already=state.votes.some(v=>v.user_id===state.userId);
 $("answer-options").innerHTML=shuffle(state.submissions).map(s=>`<button class="answer-option ${state.selectedVote===s.id?"selected":""}" data-id="${s.id}" ${s.user_id===state.userId||already||spectator?"disabled":""}>${esc(s.answer)}</button>`).join("");
 document.querySelectorAll(".answer-option").forEach(b=>b.addEventListener("click",()=>{state.selectedVote=b.dataset.id;renderVote();}));
 $("cast-vote").disabled=!state.selectedVote||already||spectator;$("cast-vote").textContent=already?"Vote submitted":"Cast my vote";
 say("vote-status",spectator?"You're spectating this round. You'll join next round.":already?"Your vote has been recorded.":"Choose your favorite answer. You cannot vote for your own.");
 const eligible=activePlayers().filter(p=>state.submissions.some(sub=>sub.user_id!==p.user_id));
 const voters=state.votes.map(v=>v.user_id);
 if(eligible.every(p=>voters.includes(p.user_id)))advanceVotingIfReady();
}
async function castVote(){
 if(!state.selectedVote)return;
 const target=state.submissions.find(s=>s.id===state.selectedVote);
 if(!target||target.user_id===state.userId)return;
 const {error}=await db().from("votes").insert({room_id:state.room.id,round_number:currentRound(),user_id:state.userId,submission_id:target.id});
 if(error)say("vote-status",error.message);state.selectedVote=null;await refresh();
}
async function finishRound(){
 if(state.room?.status!=="voting"||state.transitioning)return;
 state.transitioning=true;
 await advanceVotingIfReady();
 state.transitioning=false;await refresh();
}
function scoreRows(){
 const counts={};state.votes.forEach(v=>counts[v.submission_id]=(counts[v.submission_id]||0)+1);
 return state.submissions.map(s=>({...s,vote_count:counts[s.id]||0})).sort((a,b)=>b.vote_count-a.vote_count);
}
function ranking(){
 const points={};for(const s of state.submissions)points[s.user_id]=(points[s.user_id]||0);
 for(const v of state.votes){const sub=state.submissions.find(s=>s.id===v.submission_id);if(sub)points[sub.user_id]=(points[sub.user_id]||0)+1;}
 return state.players.map(p=>({...p,round_points:points[p.user_id]||0})).sort((a,b)=>(b.score+b.round_points)-(a.score+a.round_points));
}
function renderResults(){
 show("results-screen");const scores=scoreRows(),winner=scores[0];
 $("round-winner-title").textContent=winner&&winner.vote_count?"Top answer!":"No votes this round";
 $("winning-answer").textContent=winner?`“${winner.answer}”`:"No answer received.";
 const author=state.players.find(p=>p.user_id===winner?.user_id);$("winning-player").textContent=winner?`${author?.username||"A player"} · ${winner.vote_count} vote(s)`:"";
 $("results-round").textContent=`Round ${currentRound()} of 5`;
 const top=scoreRows()[0];
 const rows=state.players.map(p=>({...p,displayScore:p.score+(top&&top.user_id===p.user_id?top.vote_count:0)})).sort((a,b)=>b.displayScore-a.displayScore);
 $("leaderboard").innerHTML=rows.map((p,i)=>`<li><span class="player-name"><span class="rank">${i+1}.</span>${esc(p.username)}</span><span class="score">${p.displayScore} pts</span></li>`).join("");
 $("next-round").classList.toggle("hidden",!isHost());say("results-status",isHost()?"Continue when everyone is ready.":"Waiting for the host to continue.");
}
async function nextRound(){
 if(!isHost())return;
 try{
  const top=scoreRows()[0];
  if(top&&top.vote_count){const winnerPlayer=state.players.find(p=>p.user_id===top.user_id);if(winnerPlayer)await db().from("players").update({score:winnerPlayer.score+top.vote_count}).eq("id",winnerPlayer.id);}
  if(currentRound()>=5){await db().from("rooms").update({status:"finished"}).eq("id",state.room.id);}
  else{
   const next=currentRound()+1,prompt=await uniquePrompt();
   await db().from("round_ready").delete().eq("room_id",state.room.id).eq("round_number",next);
   const {error}=await db().from("rooms").update({status:"answering",round_number:next,prompt,round_deadline_at:null,voting_deadline_at:null}).eq("id",state.room.id);
   if(error)throw error;state.readySent=null;
  }
  await refresh();
 }catch(e){alert(e.message);}
}
function renderFinal(){
 show("final-screen");const rows=[...state.players].sort((a,b)=>b.score-a.score);
 $("final-winner").textContent=rows.length?`${rows[0].username} finishes with ${rows[0].score} match points!`:"Match complete.";
 $("final-leaderboard").innerHTML=rows.map((p,i)=>`<li><span class="player-name"><span class="rank">${i+1}.</span>${esc(p.username)}</span><span class="score">${p.score} pts</span></li>`).join("");
 $("play-again").classList.toggle("hidden",!isHost());
}
async function playAgain(){
 if(!isHost())return;
 try{
  await db().from("submissions").delete().eq("room_id",state.room.id);
  await db().from("votes").delete().eq("room_id",state.room.id);
  await db().from("round_ready").delete().eq("room_id",state.room.id);
  await db().from("players").update({score:0,joined_round:1}).eq("room_id",state.room.id);
  const prompt=await uniquePrompt();
  const {error}=await db().from("rooms").update({status:"answering",round_number:1,prompt,round_deadline_at:null,voting_deadline_at:null}).eq("id",state.room.id);
  if(error)throw error;state.readySent=null;await refresh();
 }catch(e){alert(e.message);}
}
async function leaveRoom(){
 if(state.channel)await db().removeChannel(state.channel);
 if(state.room){await db().from("players").delete().eq("room_id",state.room.id).eq("user_id",state.userId);await cleanupRooms();}
 state.room=null;resetRoomState();show("setup-screen");updateLeaveMatchButton();
}
async function loadPublicRooms(){
 if(!connect())return;
 await cleanupRooms();
 $("public-room-list").innerHTML='<p class="muted">Loading public rooms…</p>';
 const {data:rooms,error}=await db().from("rooms").select("*").eq("is_public",true).in("status",["lobby","answering","voting","results"]).order("created_at",{ascending:false}).limit(40);
 if(error){$("public-room-list").innerHTML=`<p class="error">${esc(error.message)}</p>`;return;}
 if(!rooms.length){$("public-room-list").innerHTML='<p class="muted">No public rooms right now. Create one and invite people!</p>';return;}
 const ids=rooms.map(r=>r.id),playerResult=await db().from("players").select("room_id,username").in("room_id",ids);
 const players=playerResult.data;
 if(playerResult.error){$("public-room-list").innerHTML=`<p class="error">${esc(playerResult.error.message)}</p>`;return;}
 $("public-room-list").innerHTML=rooms.map(r=>{
  const list=players.filter(p=>p.room_id===r.id),full=list.length>=r.max_players;
  const label=r.status==="lobby"?"Waiting room":`In match · Round ${r.round_number}/5`;
  return `<div class="room-card"><div><strong>${esc(list[0]?.username||"Player")}'s room</strong><div class="muted">${label} · ${list.length}/${r.max_players} players</div></div><button class="secondary" data-join-room="${r.id}" ${full?"disabled":""}>${full?"Full":"Join"}</button></div>`;
 }).join("");
 document.querySelectorAll("[data-join-room]").forEach(b=>b.addEventListener("click",async()=>{try{await saveName();const room=rooms.find(r=>r.id===b.dataset.joinRoom);await joinRoomRecord(room);}catch(e){alert(e.message);}}));
}
async function loadWeekly(){
 if(!connect())return;
 $("weekly-list").innerHTML="<li>Loading…</li>";
 const {data,error}=await db().from("weekly_scores").select("username,points,user_id").eq("week_start",utcWeek()).order("points",{ascending:false}).limit(100);
 if(error){$("weekly-list").innerHTML=`<li class="error">${esc(error.message)}</li>`;return;}
 $("weekly-list").innerHTML=data.length?data.map((p,i)=>`<li><span class="player-name"><span class="rank">${i+1}.</span>${esc(p.username)}</span><span class="score">${p.points} votes</span></li>`).join(""):"<li>No votes yet this week. Be the first!</li>";
}
function setTheme(theme){
 document.documentElement.dataset.theme=theme;localStorage.setItem("cr-theme",theme);
 $("theme-toggle").textContent=theme==="dark"?"☀ Light":"☾ Dark";
}
$("username").value=state.username;
setTheme(localStorage.getItem("cr-theme")||"light");
$("theme-toggle").addEventListener("click",()=>setTheme(document.documentElement.dataset.theme==="dark"?"light":"dark"));
$("create-room").addEventListener("click",createRoom);
$("join-room").addEventListener("click",joinByCode);
$("start-game").addEventListener("click",startGame);
$("save-room-settings").addEventListener("click",saveRoomSettings);
$("submit-answer").addEventListener("click",submitAnswer);
$("cast-vote").addEventListener("click",castVote);
$("next-round").addEventListener("click",nextRound);
$("play-again").addEventListener("click",playAgain);
$("leave-lobby").addEventListener("click",leaveRoom);
$("back-home").addEventListener("click",leaveRoom);
$("brand-home").addEventListener("click",e=>{e.preventDefault();if(!state.room)show("setup-screen");});
$("copy-code").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(state.room.code);$("copy-code").textContent="Copied!";}catch{say("lobby-status","Room code: "+state.room.code);}});
$("room-code").addEventListener("input",e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""));
$("browse-rooms").addEventListener("click",()=>{show("browse-screen");loadPublicRooms();});
$("browse-back").addEventListener("click",()=>show("setup-screen"));
$("refresh-rooms").addEventListener("click",loadPublicRooms);
$("weekly-open").addEventListener("click",()=>{show("weekly-screen");loadWeekly();});
$("weekly-back").addEventListener("click",()=>show("setup-screen"));
$("weekly-refresh").addEventListener("click",loadWeekly);
installLeaveMatchButton();
if(configured)connect();else $("connection").textContent="Connect Supabase to play online";
state.tick=setInterval(()=>{if(state.room?.status==="answering")updateTimer();else if(state.room?.status==="voting")updateVoteTimer();},500);
state.roomPoll=setInterval(()=>{if(state.room)refresh();else if(!$("browse-screen").classList.contains("hidden"))loadPublicRooms();},5000);
setInterval(()=>{if(state.room){heartbeat();cleanupRooms();}},15000);
})();