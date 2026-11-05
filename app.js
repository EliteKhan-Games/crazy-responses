(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const S = {
    id: localStorage.cr_player_id || crypto.randomUUID(),
    name: "",
    code: null,
    room: null,
    players: [],
    round: null,
    poll: null,
    timer: null,
    pollBusy: false,
    refreshBusy: false,
    sb: null,
    renderKey: null,
    pendingVoteRound: null,
    votedRoundId: null,
    pendingAnswer: false,
    pendingActions: new Set(),
    chatLoadedFor: null,
    lastChatPoll: 0,
    chatBusy: false
  };
  localStorage.cr_player_id = S.id;

  const prompts = [
    "The worst thing to hear from your GPS is ______.",
    "Nobody expected the town meeting to be about ______.",
    "The secret ingredient in grandma's recipe is ______.",
    "A new Olympic sport has been announced: competitive ______.",
    "The alien's first words on Earth were: Take me to ______."
  ];

  const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));

  function screen(id) {
    document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
    if ($(id)) $(id).classList.add("active");
  }

  function msg(id, value) {
    if ($(id)) $(id).textContent = value || "";
  }

  function toast(value) {
    if (!$("toast")) return;
    $("toast").textContent = value;
    $("toast").style.display = "block";
    clearTimeout(S.toastTimer);
    S.toastTimer = setTimeout(() => { $("toast").style.display = "none"; }, 2200);
  }

  function name() {
    S.name = $("usernameInput").value.trim().slice(0, 20);
    if (!S.name) throw new Error("Enter a display name.");
    localStorage.cr_name = S.name;
    return S.name;
  }

  function ensureSupabase() {
    if (S.sb) return S.sb;
    const c = window.CRAZY_CONFIG || {};
    if (!c.SUPABASE_URL || !c.SUPABASE_ANON_KEY ||
        c.SUPABASE_URL.includes("YOUR-") || c.SUPABASE_ANON_KEY.includes("YOUR_")) {
      throw new Error("Supabase config is missing. Check config.js beside index.html.");
    }
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Supabase library did not load. Check your internet connection and refresh.");
    }
    S.sb = window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY);
    if ($("connectionState")) $("connectionState").textContent = "Connected";
    return S.sb;
  }

  async function rpc(functionName, args = {}) {
    const client = ensureSupabase();
    const { data, error } = await client.rpc(functionName, args);
    if (error) throw error;
    return data;
  }

  async function create() {
    try {
      name();
      msg("createError", "");
      const data = await rpc("cr_create_room", {
        p_player_id: S.id,
        p_player_name: S.name,
        p_room_name: $("roomNameInput").value,
        p_visibility: $("visibilityInput").value,
        p_player_limit: +$("playerLimitInput").value,
        p_round_count: +$("roundCountInput").value,
        p_prompt_style: $("promptStyleInput").value
      });
      await enter(data.room_code);
    } catch (error) {
      msg("createError", error.message);
    }
  }

  async function join(code) {
    try {
      name();
      const data = await rpc("cr_join_room", {
        p_room_code: code,
        p_player_id: S.id,
        p_player_name: S.name
      });
      await enter(data.room_code);
    } catch (error) {
      msg("homeError", error.message);
    }
  }

  async function enter(code) {
    clearInterval(S.poll);
    clearInterval(S.timer);
    S.code = code;
    localStorage.cr_last_room_code = code;
    S.renderKey = null;
    S.chatLoadedFor = null;
    S.votedRoundId = null;
    S.pendingVoteRound = null;
    S.pendingAnswer = false;
    screen("roomScreen");
    await refresh();
    S.poll = setInterval(pollRoom, 2000);
    // The UI timer is local and smooth. It is always calculated from the server deadline.
    S.timer = setInterval(updateTimerUI, 200);
  }

  async function pollRoom() {
    if (!S.code || S.pollBusy) return;
    S.pollBusy = true;
    try {
      await rpc("cr_heartbeat", { p_room_code: S.code, p_player_id: S.id });
      // Server-side deadline handling: answering -> voting -> results -> next round.
      await rpc("cr_tick_room", { p_room_code: S.code });
      await refresh();
      if (S.room?.status === "lobby" && Date.now() - S.lastChatPoll > 5000) {
        S.chatLoadedFor = null;
        await loadChat();
        S.lastChatPoll = Date.now();
      }
    } catch (error) {
      console.warn("Room refresh:", error.message);
    } finally {
      S.pollBusy = false;
    }
  }

  async function refresh() {
    if (!S.code || S.refreshBusy) return;
    S.refreshBusy = true;
    try {
      const data = await rpc("cr_room_state", {
        p_room_code: S.code,
        p_player_id: S.id
      });
      if (!data?.room) {
        leaveLocal("Room expired or no longer exists.");
        return;
      }
      S.room = data.room;
      S.players = data.players || [];
      S.round = data.round;
      renderRoom();
      if (S.room.status !== "lobby") {
        screen("gameScreen");
        renderGame();
      } else {
        screen("roomScreen");
      }
    } finally {
      S.refreshBusy = false;
    }
  }

  function renderRoom() {
    const room = S.room;
    if (!room) return;
    $("roomNameHeading").textContent = room.room_name;
    $("roomCodeLabel").textContent = room.room_code;
    $("roomMeta").textContent = `${room.visibility} · ${room.round_count} rounds · up to ${room.player_limit} players · ${room.prompt_style}`;
    $("playerCount").textContent = S.players.length;
    $("playersList").innerHTML = S.players.map((player) =>
      `<div>${esc(player.player_name)} ${player.player_id === room.host_player_id ? "· HOST" : ""} ${player.is_spectator ? "· SPECTATOR" : ""}</div>`
    ).join("");
    const isHost = room.host_player_id === S.id;
    $("hostBadge").classList.toggle("hidden", !isHost);
    $("hostSettings").classList.toggle("hidden", !isHost || room.status !== "lobby");
    $("startGameBtn").classList.toggle("hidden", !isHost);
    $("startGameBtn").disabled = S.players.filter((player) => !player.is_spectator).length < 3;
    // Do not overwrite a setting field while its owner is actively editing it.
    const settings = [
      ["editRoomName", room.room_name],
      ["editVisibility", room.visibility],
      ["editLimit", room.player_limit],
      ["editRounds", room.round_count],
      ["editPromptStyle", room.prompt_style]
    ];
    settings.forEach(([id, value]) => {
      const field = $(id);
      if (field && document.activeElement !== field) field.value = value;
    });
    if (S.chatLoadedFor !== room.room_code) loadChat().catch((error) => console.warn(error));
  }

  async function loadChat() {
    if (S.chatBusy || !S.code) return;
    S.chatBusy = true;
    try {
      const messages = await rpc("cr_chat_history", { p_room_code: S.code });
      $("chatMessages").innerHTML = messages.map((item) =>
        `<div><b>${esc(item.player_name)}</b>: ${esc(item.message)}</div>`
      ).join("");
      S.chatLoadedFor = S.room?.room_code || S.code;
    } finally {
      S.chatBusy = false;
    }
  }

  function phaseDuration(phase) {
    if (phase === "answering") return 60;
    if (phase === "voting") return 30;
    if (phase === "results") return 15;
    return 60;
  }

  function updateTimerUI() {
    const round = S.round;
    if (!round || !round.deadline_at || !$("gameTimer")) return;
    const duration = phaseDuration(round.phase);
    const end = new Date(round.deadline_at).getTime();
    const seconds = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    $("gameTimer").textContent = String(seconds);
    if ($("gameProgress")) {
      const percent = Math.max(0, Math.min(100, (seconds / duration) * 100));
      $("gameProgress").style.width = `${percent}%`;
    }
  }

  function renderGame() {
    const round = S.round;
    if (!round) {
      const key = "no-round";
      if (S.renderKey !== key) {
        S.renderKey = key;
        $("gameContent").textContent = "Waiting for the next round…";
      }
      return;
    }

    const key = `${round.id || round.round_number}:${round.phase}`;
    // Crucial: polling must not replace the textarea/buttons while a player is interacting.
    if (S.renderKey === key) {
      syncVoteButtons();
      updateTimerUI();
      return;
    }
    S.renderKey = key;

    $("gameRoundPill").textContent = `Round ${round.round_number} / ${S.room.round_count}`;
    const me = S.players.find((player) => player.player_id === S.id);
    let html = `<p class="tag">${esc(round.phase)}</p><h2>${esc(round.prompt_text)}</h2>`;

    if (me?.is_spectator) {
      html += "<p>You're spectating until the next round.</p>";
    } else if (round.phase === "answering") {
      html += '<label class="answer-label" for="answerInput">Your response</label>';
      const answerKey = `cr_answer_count_${round.id}`;
      const answerCount = Number(localStorage.getItem(answerKey) || 0);
      const savedDraft = localStorage.getItem(`cr_draft_${round.id}`) || "";
      html += `<textarea id="answerInput" maxlength="180" placeholder="Type your funniest response…" ${answerCount >= 2 ? "disabled" : ""}>${esc(savedDraft)}</textarea>`;
      html += `<button id="answerBtn" type="button" ${answerCount >= 2 ? "disabled" : ""}>${answerCount === 0 ? "Submit response" : (answerCount === 1 ? "Update response" : "Response locked")}</button>`;
    } else if (round.phase === "voting") {
      const responses = round.answers || [];
      const hasVoted = localStorage.getItem(`cr_voted_${round.id}`) === "1" || S.votedRoundId === round.id;
      if (!responses.length) html += "<p>No answers were submitted this round.</p>";
      html += responses.map((answer) => {
        const ownAnswer = answer.player_id === S.id;
        const disabled = ownAnswer || hasVoted;
        return `<div class="room vote-card"><div class="vote-answer">${esc(answer.answer_text)}</div><button type="button" data-vote="${esc(answer.response_id)}" ${disabled ? "disabled" : ""}>${ownAnswer ? "Your answer" : (hasVoted ? "Vote recorded" : "Vote")}</button></div>`;
      }).join("");
      if (hasVoted) html += '<p class="tag">Your vote has been recorded.</p>';
    } else if (round.phase === "results") {
      html += "<h3>Round results</h3>" + (round.results || []).map((item) =>
        `<p>${esc(item.answer_text)} — ${item.votes} votes</p>`
      ).join("");
      if (S.room.host_player_id === S.id) html += '<button id="nextBtn" type="button">Continue</button>';
      else html += "<p>Waiting for the host or the results timer…</p>";
    } else if (round.phase === "finished") {
      html += "<h3>Game over!</h3>";
      if (S.room.host_player_id === S.id) html += '<button id="rematchBtn" type="button">Play again</button>';
    } else {
      html += "<p>Waiting for players…</p>";
    }

    $("gameContent").innerHTML = html;
    updateTimerUI();
    syncVoteButtons();
  }

  function syncVoteButtons() {
    if (!S.round || S.round.phase !== "voting" || !$("gameContent")) return;
    const voted = S.votedRoundId === S.round.id || localStorage.getItem(`cr_voted_${S.round.id}`) === "1";
    if (voted || S.pendingVoteRound === S.round.id) {
      $("gameContent").querySelectorAll("[data-vote]").forEach((button) => {
        button.disabled = true;
        if (voted) button.textContent = button.textContent === "Your answer" ? "Your answer" : "Vote recorded";
      });
    }
  }

  async function submitAnswer(button) {
    if (S.pendingAnswer || !S.round) return;
    const input = $("answerInput");
    const answer = input?.value.trim();
    if (!answer) {
      toast("Type an answer first.");
      input?.focus();
      return;
    }
    const roundId = S.round.id;
    const answerKey = `cr_answer_count_${roundId}`;
    const currentCount = Number(localStorage.getItem(answerKey) || 0);
    if (currentCount >= 2) {
      toast("Your response is locked.");
      return;
    }
    S.pendingAnswer = true;
    button.disabled = true;
    button.textContent = "Submitting…";
    try {
      await rpc("cr_submit_answer", {
        p_room_code: S.code,
        p_player_id: S.id,
        p_answer: answer
      });
      const nextCount = currentCount + 1;
      localStorage.setItem(answerKey, String(nextCount));
      localStorage.setItem(`cr_draft_${roundId}`, answer);
      const stillCanEdit = nextCount < 2;
      button.disabled = !stillCanEdit;
      button.textContent = stillCanEdit ? "Update response" : "Response locked";
      if (!stillCanEdit) input.disabled = true;
      toast(stillCanEdit ? "Response submitted. You can edit it once." : "Response locked.");
      await refresh();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Submit response";
      toast(error.message);
    } finally {
      S.pendingAnswer = false;
    }
  }

  async function submitVote(button, responseId) {
    const roundId = S.round?.id;
    if (!roundId || S.pendingVoteRound === roundId || S.votedRoundId === roundId ||
        localStorage.getItem(`cr_voted_${roundId}`) === "1") return;

    S.pendingVoteRound = roundId;
    const voteButtons = $("gameContent").querySelectorAll("[data-vote]");
    voteButtons.forEach((item) => { item.disabled = true; });
    button.textContent = "Submitting…";
    try {
      await rpc("cr_vote", {
        p_room_code: S.code,
        p_player_id: S.id,
        p_response_id: responseId
      });
      S.votedRoundId = roundId;
      localStorage.setItem(`cr_voted_${roundId}`, "1");
      voteButtons.forEach((item) => {
        item.disabled = true;
        item.textContent = item.dataset.vote === responseId ? "Vote submitted" : "Vote recorded";
      });
      toast("Vote submitted.");
      await refresh();
    } catch (error) {
      voteButtons.forEach((item) => {
        const isOwnAnswer = S.round?.answers?.some((answer) => answer.response_id === item.dataset.vote && answer.player_id === S.id);
        item.disabled = !!isOwnAnswer;
        if (!isOwnAnswer) item.textContent = "Vote";
      });
      toast(error.message);
    } finally {
      S.pendingVoteRound = null;
    }
  }

  async function action(functionName, params = {}) {
    if (S.pendingActions.has(functionName)) return;
    S.pendingActions.add(functionName);
    try {
      await rpc(functionName, { p_room_code: S.code, p_player_id: S.id, ...params });
      await refresh();
    } catch (error) {
      toast(error.message);
    } finally {
      S.pendingActions.delete(functionName);
    }
  }

  async function browser() {
    screen("browserScreen");
    try {
      const rooms = await rpc("cr_public_rooms");
      $("publicRoomsList").innerHTML = rooms.length ? rooms.map((room) =>
        `<div class="room"><b>${esc(room.room_name)}</b> · ${room.player_count}/${room.player_limit} <button type="button" data-room="${esc(room.room_code)}">${room.player_count ? "Join / Spectate" : "Join"}</button></div>`
      ).join("") : "No public rooms yet.";
    } catch (error) {
      $("publicRoomsList").textContent = error.message;
    }
  }

  function leaveLocal(message) {
    clearInterval(S.poll);
    clearInterval(S.timer);
    S.poll = null;
    S.timer = null;
    S.code = null;
    localStorage.removeItem("cr_last_room_code");
    S.room = null;
    S.round = null;
    S.renderKey = null;
    screen("homeScreen");
    if (message) toast(message);
  }

  async function leave() {
    try {
      await rpc("cr_leave_room", { p_room_code: S.code, p_player_id: S.id });
    } catch (error) {
      console.warn("Leave room:", error.message);
    }
    leaveLocal("You left the room.");
  }

  function bind() {
    $("createRoomBtn").onclick = () => screen("createScreen");
    $("showJoinBtn").onclick = () => $("joinRow").classList.toggle("hidden");
    $("browseRoomsBtn").onclick = browser;
    $("refreshRoomsBtn").onclick = browser;
    $("browserBackBtn").onclick = () => screen("homeScreen");
    $("cancelCreateBtn").onclick = () => screen("homeScreen");
    $("confirmCreateBtn").onclick = create;
    $("joinRoomBtn").onclick = () => join($("roomCodeInput").value.trim().toUpperCase());
    $("roomCodeInput").onkeydown = (event) => {
      if (event.key === "Enter") join(event.target.value.trim().toUpperCase());
    };
    $("startGameBtn").onclick = () => action("cr_start_game");
    $("leaveRoomBtn").onclick = leave;
    $("gameLeaveBtn").onclick = leave;
    $("saveSettingsBtn").onclick = () => action("cr_update_room", {
      p_room_name: $("editRoomName").value,
      p_visibility: $("editVisibility").value,
      p_player_limit: +$("editLimit").value,
      p_round_count: +$("editRounds").value,
      p_prompt_style: $("editPromptStyle").value
    });
    $("chatForm").onsubmit = async (event) => {
      event.preventDefault();
      const value = $("chatInput").value.trim();
      if (!value) return;
      try {
        await rpc("cr_send_chat", { p_room_code: S.code, p_player_id: S.id, p_message: value });
        $("chatInput").value = "";
        S.chatLoadedFor = null;
        await loadChat();
      } catch (error) {
        toast(error.message);
      }
    };
    $("copyCodeBtn").onclick = () => navigator.clipboard?.writeText(S.code).then(() => toast("Code copied."));
    $("homeLink").onclick = (event) => { event.preventDefault(); leaveLocal(); };
    $("publicRoomsList").onclick = (event) => {
      const button = event.target.closest("[data-room]");
      if (button) join(button.dataset.room);
    };
    $("gameContent").addEventListener("input", (event) => {
      if (event.target.id === "answerInput" && S.round?.id) {
        localStorage.setItem(`cr_draft_${S.round.id}`, event.target.value);
      }
    });
    $("gameContent").onclick = (event) => {
      const voteButton = event.target.closest("[data-vote]");
      if (voteButton && $("gameContent").contains(voteButton)) {
        event.preventDefault();
        submitVote(voteButton, voteButton.dataset.vote);
        return;
      }
      const button = event.target.closest("button");
      if (!button || !$("gameContent").contains(button)) return;
      if (button.id === "answerBtn") submitAnswer(button);
      else if (button.id === "nextBtn") action("cr_next_round");
      else if (button.id === "rematchBtn") action("cr_rematch");
    };
    $("themeToggle").onclick = () => {
      const theme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = theme;
      localStorage.cr_theme = theme;
    };
    $("soundToggle").onclick = () => toast("Sound effects are not enabled in this build.");
    $("showLeaderboardBtn").onclick = async () => {
      screen("leaderboardScreen");
      try {
        const rows = await rpc("cr_weekly_leaderboard");
        $("leaderboardList").innerHTML = rows.map((row, index) =>
          `<p>${index + 1}. ${esc(row.player_name)} — ${row.points}</p>`
        ).join("") || "No scores this week.";
      } catch (error) {
        $("leaderboardList").textContent = error.message;
      }
    };
    $("leaderboardBackBtn").onclick = () => screen("homeScreen");
  }

  document.addEventListener("DOMContentLoaded", () => {
    bind();
    const savedName = localStorage.cr_name;
    if (savedName) $("usernameInput").value = savedName;
    if (localStorage.cr_theme) document.documentElement.dataset.theme = localStorage.cr_theme;
    try {
      ensureSupabase();
      rpc("cr_cleanup").catch((error) => console.warn("Supabase cleanup:", error.message));
      const previousRoom = localStorage.cr_last_room_code;
      if (previousRoom && localStorage.cr_name) join(previousRoom);
    } catch (error) {
      if ($("connectionState")) $("connectionState").textContent = "Connection error";
      msg("homeError", error.message);
    }
  });
})();
