const SUPABASE_URL = "https://vkvrwayzqrlsfsgjjwpy.supabase.co";

const SUPABASE_KEY =
  "sb_publishable_-kj7hiC7uou3db2wpwFM_w_jgXQNpnb";


const { createClient } = supabase;


const db = createClient(
  SUPABASE_URL,
  SUPABASE_KEY,
  {
    auth:{
      persistSession:true,
      autoRefreshToken:true,
      detectSessionInUrl:false
    }
  }
);


const tg =
  window.Telegram?.WebApp;


let currentUser = null;
let currentProfile = null;
let currentProject = null;

let members = [];
let contents = [];
let publications = [];
let assigneeRows = [];

let currentMonth = new Date();

let activePeriod = "week";

let realtimeChannels = [];

let memberPoll = null;


const $ = id =>
  document.getElementById(id);


const esc = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    c =>
      ({
        "&":"&amp;",
        "<":"&lt;",
        ">":"&gt;",
        '"':"&quot;",
        "'":"&#039;"
      }[c])
  );


const pad = n =>
  String(n).padStart(2,"0");


const isoToday = () => {

  const d =
    new Date();

  return (
    `${d.getFullYear()}-` +
    `${pad(d.getMonth()+1)}-` +
    `${pad(d.getDate())}`
  );

};


const monthNames = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь"
];


const shortMonths = [
  "янв",
  "фев",
  "мар",
  "апр",
  "май",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек"
];


function telegramInitData(){

  return tg?.initData || "";

}


function toast(text){

  const old =
    document.querySelector(".toast");

  if(old){
    old.remove();
  }


  const el =
    document.createElement("div");

  el.className =
    "toast";

  el.textContent =
    text;

  document.body.appendChild(
    el
  );


  setTimeout(
    () => el.remove(),
    2200
  );

}


function avatarHtml(
  profile,
  cls = ""
){

  const name =
    profile?.telegram_first_name ||
    profile?.telegram_username ||
    "?";


  const initials =
    name
      .slice(0,2)
      .toUpperCase();


  if(
    profile?.telegram_photo_url
  ){

    return `
      <div class="avatar ${cls}">
        <img
          src="${esc(
            profile.telegram_photo_url
          )}"
          alt=""
        >
      </div>
    `;

  }


  return `
    <div class="avatar ${cls}">
      ${esc(initials)}
    </div>
  `;

}


function platformClass(
  platform
){

  return String(
    platform || ""
  )
    .toLowerCase()
    .replace(
      /[^a-zа-яё]/gi,
      ""
    );

}


/* =========================================================
   ЗАПУСК
========================================================= */

async function boot(){

  try{

    tg?.ready();

    tg?.expand();


    if(
      tg?.setHeaderColor
    ){

      tg.setHeaderColor(
        "#f7f7f4"
      );

    }


    if(
      tg?.setBackgroundColor
    ){

      tg.setBackgroundColor(
        "#f7f7f4"
      );

    }


    const {
      data:sessionData
    } =
      await db.auth.getSession();


    if(
      !sessionData.session
    ){

      const {
        error
      } =
        await db.auth
          .signInAnonymously();


      if(error){
        throw error;
      }

    }


    const {
      data:sessionNow
    } =
      await db.auth.getSession();


    currentUser =
      sessionNow.session.user;


    if(
      !telegramInitData()
    ){

      throw new Error(
        "Откройте планер через Telegram."
      );

    }


    const authResult =
      await db.functions.invoke(
        "telegram-auth",
        {
          body:{
            initData:
              telegramInitData()
          }
        }
      );


    if(
      authResult.error
    ){

      throw authResult.error;

    }


    await loadProfile();

    await ensureProject();

    await loadAll();

    setupRealtime();

    startMemberPolling();

    showApp();

  }
  catch(err){

    console.error(err);

    showAuthError(
      err?.message ||
      "Не удалось открыть планер"
    );

  }

}


/* =========================================================
   ПРОФИЛЬ
========================================================= */

async function loadProfile(){

  const {
    data,
    error
  } =
    await db
      .from("profiles")
      .select("*")
      .eq(
        "id",
        currentUser.id
      )
      .maybeSingle();


  if(error){
    throw error;
  }


  currentProfile =
    data;

}


/* =========================================================
   ПРОЕКТ
========================================================= */

async function ensureProject(){

  let {
    data,
    error
  } =
    await db
      .from("projects")
      .select("*")
      .order(
        "created_at",
        {
          ascending:true
        }
      )
      .limit(1)
      .maybeSingle();


  if(error){
    throw error;
  }


  if(!data){

    const {
      data:created,
      error:createError
    } =
      await db.rpc(
        "create_default_project"
      );


    if(createError){
      throw createError;
    }


    data =
      Array.isArray(created)
        ? created[0]
        : created;

  }


  if(!data){

    throw new Error(
      "Не найден проект команды."
    );

  }


  currentProject =
    data;


  const {
    error:memberError
  } =
    await db
      .from("project_members")
      .upsert(
        {
          project_id:
            currentProject.id,

          user_id:
            currentUser.id
        },
        {
          onConflict:
            "project_id,user_id",

          ignoreDuplicates:
            true
        }
      );


  if(memberError){

    console.warn(
      "membership:",
      memberError.message
    );

  }

}


/* =========================================================
   ЗАГРУЗКА
========================================================= */

async function loadAll(){

  await Promise.all([
    loadMembers(),
    loadContent()
  ]);


  renderEverything();

}


async function loadMembers(){

  const {
    data,
    error
  } =
    await db
      .from("profiles")
      .select(
        `
        id,
        telegram_id,
        telegram_username,
        telegram_first_name,
        telegram_photo_url
        `
      )
      .not(
        "telegram_id",
        "is",
        null
      )
      .order(
        "telegram_first_name",
        {
          ascending:true
        }
      );


  if(error){

    console.warn(
      "members:",
      error.message
    );

    members = [];

    return;

  }


  members =
    data || [];


  renderTeam();

}


async function loadContent(){

  if(!currentProject){
    return;
  }


  const {
    data:c,
    error:ce
  } =
    await db
      .from("content")
      .select("*")
      .eq(
        "project_id",
        currentProject.id
      )
      .order(
        "created_at",
        {
          ascending:false
        }
      );


  if(ce){
    throw ce;
  }


  const {
    data:p,
    error:pe
  } =
    await db
      .from("publications")
      .select("*")
      .eq(
        "project_id",
        currentProject.id
      )
      .order(
        "publication_date",
        {
          ascending:true
        }
      )
      .order(
        "publication_time",
        {
          ascending:true,
          nullsFirst:false
        }
      );


  if(pe){
    throw pe;
  }


  const ids =
    (p || [])
      .map(
        x => x.id
      );


  let a = [];


  if(ids.length){

    const {
      data,
      error:ae
    } =
      await db
        .from(
          "publication_assignees"
        )
        .select(
          "publication_id,user_id"
        )
        .in(
          "publication_id",
          ids
        );


    if(ae){
      throw ae;
    }


    a =
      data || [];

  }


  contents =
    c || [];


  publications =
    p || [];


  assigneeRows =
    a;

}


/* =========================================================
   REALTIME
========================================================= */

function setupRealtime(){

  realtimeChannels
    .forEach(
      channel =>
        db.removeChannel(
          channel
        )
    );


  realtimeChannels = [];


  [
    "content",
    "publications",
    "publication_assignees"
  ]
    .forEach(
      table => {

        const channel =
          db
            .channel(
              `planner-${table}`
            )
            .on(
              "postgres_changes",
              {
                event:"*",
                schema:"public",
                table
              },
              async () => {

                await loadContent();

                renderEverything();

              }
            )
            .subscribe();


        realtimeChannels.push(
          channel
        );

      }
    );

}


function startMemberPolling(){

  clearInterval(
    memberPoll
  );


  memberPoll =
    setInterval(
      async () => {

        await loadMembers();

      },
      15000
    );

}


/* =========================================================
   APP
========================================================= */

function showApp(){

  $("authScreen")
    .classList
    .add("hidden");


  $("app")
    .classList
    .remove("hidden");


  switchView(
    "calendarView"
  );

}


function showAuthError(
  message
){

  const card =
    document.querySelector(
      ".auth-card"
    );


  card.innerHTML = `

    <div class="logo-mark">
      !
    </div>

    <h1>
      Не удалось открыть
    </h1>

    <p>
      ${esc(message)}
    </p>

  `;

}


/* =========================================================
   НАВИГАЦИЯ
========================================================= */

function switchView(
  viewId
){

  document
    .querySelectorAll(
      ".view"
    )
    .forEach(
      view => {

        view.classList.toggle(
          "active",
          view.id === viewId
        );

      }
    );


  document
    .querySelectorAll(
      ".nav-item"
    )
    .forEach(
      button => {

        button.classList.toggle(
          "active",
          button.dataset.view ===
          viewId
        );

      }
    );

}


function renderEverything(){

  renderCalendar();

  renderUpcoming();

  renderContent();

  renderTeam();

  renderAnalytics();

}


/* =========================================================
   КАЛЕНДАРЬ
========================================================= */

function renderCalendar(){

  const year =
    currentMonth.getFullYear();


  const month =
    currentMonth.getMonth();


  const grid =
    $("calendarGrid");


  if(!grid){
    return;
  }


  $("monthLabel")
    .textContent =
      `${monthNames[month]} ${year}`;


  const first =
    new Date(
      year,
      month,
      1
    );


  const daysInMonth =
    new Date(
      year,
      month + 1,
      0
    ).getDate();


  const prevDays =
    (
      first.getDay() +
      6
    ) % 7;


  const totalCells =
    Math.ceil(
      (
        prevDays +
        daysInMonth
      ) / 7
    ) * 7;


  grid.innerHTML =
    "";


  for(
    let i = 0;
    i < totalCells;
    i++
  ){

    const day =
      i -
      prevDays +
      1;


    const cell =
      document.createElement(
        "div"
      );


    cell.className =
      "calendar-cell";


    let date;
    let shownDay;


    if(day < 1){

      const d =
        new Date(
          year,
          month,
          day
        );


      date =
        toISO(d);

      shownDay =
        d.getDate();


      cell.classList.add(
        "muted"
      );

    }
    else if(
      day > daysInMonth
    ){

      const d =
        new Date(
          year,
          month,
          day
        );


      date =
        toISO(d);

      shownDay =
        d.getDate();


      cell.classList.add(
        "muted"
      );

    }
    else{

      date =
        `${year}-${pad(month+1)}-${pad(day)}`;

      shownDay =
        day;

    }


    cell.dataset.date =
      date;


    const isToday =
      date === isoToday();


    cell.innerHTML = `

      <div
        class="day-number ${
          isToday
            ? "today"
            : ""
        }"
      >
        ${shownDay}
      </div>

    `;


    /*
      ВАЖНО:
      клик по всей ячейке
      открывает подробности
      именно этой даты.
    */

    cell.addEventListener(
      "click",
      () =>
        openDayDetails(
          date
        )
    );


    const dayPubs =
      publications
        .filter(
          p =>
            p.publication_date ===
            date
        )
        .sort(
          sortPublication
        );


    /*
      В календаре показываем
      максимум 3 публикации,
      чтобы сетка не разваливалась.
    */

    dayPubs
      .slice(
        0,
        3
      )
      .forEach(
        p => {

          const chip =
            document.createElement(
              "button"
            );


          chip.type =
            "button";


          chip.className =
            `pub-chip ${
              platformClass(
                p.platform
              )
            } ${
              p.status === "done"
                ? "done"
                : ""
            }`;


          chip.innerHTML = `

            <span class="pub-time">

              ${
                p.publication_time
                  ? esc(
                      p.publication_time
                        .slice(0,5)
                    )
                  : ""
              }

            </span>

            ${esc(p.title)}

          `;


          chip.title =
            `${p.platform} · ${p.format} · ${p.title}`;


          chip.addEventListener(
            "click",
            e => {

              e.stopPropagation();

              openModal(
                p.content_id
              );

            }
          );


          cell.appendChild(
            chip
          );

        }
      );


    if(
      dayPubs.length > 3
    ){

      const more =
        document.createElement(
          "button"
        );


      more.type =
        "button";


      more.className =
        "calendar-more";


      more.textContent =
        `+ ещё ${
          dayPubs.length - 3
        }`;


      more.addEventListener(
        "click",
        e => {

          e.stopPropagation();

          openDayDetails(
            date
          );

        }
      );


      cell.appendChild(
        more
      );

    }


    grid.appendChild(
      cell
    );

  }

}


function toISO(
  date
){

  return (
    `${date.getFullYear()}-` +
    `${pad(date.getMonth()+1)}-` +
    `${pad(date.getDate())}`
  );

}


/* =========================================================
   ДЕТАЛИ ДНЯ
========================================================= */

function openDayDetails(
  date
){

  const pubs =
    publications
      .filter(
        p =>
          p.publication_date ===
          date
      )
      .sort(
        sortPublication
      );


  const d =
    new Date(
      `${date}T12:00:00`
    );


  $("dayModalEyebrow")
    .textContent =
      `${d.getDate()} ` +
      `${shortMonths[d.getMonth()]} ` +
      `${d.getFullYear()}`;


  $("dayModalTitle")
    .textContent =
      pubs.length

        ? `${pubs.length} ${
            plural(
              pubs.length,
              "публикация",
              "публикации",
              "публикаций"
            )
          }`

        : "Пока пусто";


  $("dayModalSubtitle")
    .textContent =
      pubs.length

        ? "Расписание публикаций на эту дату"

        : "На эту дату ещё ничего не запланировано";


  $("addPublicationForDay")
    .dataset.date =
      date;


  const box =
    $("dayPublicationList");


  if(!pubs.length){

    box.innerHTML = `

      <div class="empty">
        Добавь первую публикацию на этот день.
      </div>

    `;

  }
  else{

    box.innerHTML =
      pubs
        .map(
          p => {

            const assignees =
              publicationAssignees(
                p.id
              );


            const avatars =
              assignees
                .slice(0,3)
                .map(
                  m =>
                    avatarHtml(m)
                )
                .join("");


            return `

              <button
                type="button"
                class="day-publication"
                data-day-pub="${p.id}"
              >

                <div class="day-pub-time">

                  ${
                    p.publication_time
                      ? esc(
                          p.publication_time
                            .slice(0,5)
                        )
                      : "—"
                  }

                </div>


                <span
                  class="platform-dot ${
                    platformClass(
                      p.platform
                    )
                  }"
                ></span>


                <div class="day-pub-main">

                  <div class="day-pub-title">
                    ${esc(p.title)}
                  </div>

                  <div class="day-pub-meta">
                    ${esc(p.platform)}
                    ·
                    ${esc(p.format)}
                  </div>

                </div>


                <div class="assignee-mini">
                  ${avatars}
                </div>


                <span class="chevron">
                  ›
                </span>

              </button>

            `;

          }
        )
        .join("");


    box
      .querySelectorAll(
        "[data-day-pub]"
      )
      .forEach(
        button => {

          button.addEventListener(
            "click",
            () => {

              const p =
                publications.find(
                  x =>
                    x.id ===
                    button.dataset.dayPub
                );


              closeDayDetails();


              if(p){

                openModal(
                  p.content_id
                );

              }

            }
          );

        }
      );

  }


  $("dayModal")
    .classList
    .remove("hidden");

}


function closeDayDetails(){

  $("dayModal")
    .classList
    .add("hidden");

}


/* =========================================================
   БЛИЖАЙШИЕ
========================================================= */

function renderUpcoming(){

  const now =
    new Date();


  const upcoming =
    [...publications]
      .sort(
        sortPublication
      )
      .filter(
        p => {

          const dt =
            p.publication_time

              ? new Date(
                  `${p.publication_date}T${p.publication_time}`
                )

              : new Date(
                  `${p.publication_date}T23:59:00`
                );


          return dt >= now;

        }
      )
      .slice(
        0,
        6
      );


  const box =
    $("upcomingList");


  if(
    !upcoming.length
  ){

    box.innerHTML = `

      <div class="empty">
        Пока нет запланированных публикаций.
      </div>

    `;

    return;

  }


  box.innerHTML =
    upcoming
      .map(
        p => {

          const assignees =
            publicationAssignees(
              p.id
            );


          const avatars =
            assignees
              .slice(0,3)
              .map(
                m =>
                  avatarHtml(m)
              )
              .join("");


          return `

            <button
              class="upcoming-card"
              data-pub="${p.id}"
              type="button"
            >

              <div class="date-box">

                <strong>
                  ${p.publication_date.slice(8)}
                </strong>

                <span>

                  ${
                    shortMonths[
                      Number(
                        p.publication_date
                          .slice(5,7)
                      ) - 1
                    ]
                  }

                </span>

              </div>


              <span
                class="platform-dot ${
                  platformClass(
                    p.platform
                  )
                }"
              ></span>


              <div class="upcoming-main">

                <div class="upcoming-title">
                  ${esc(p.title)}
                </div>

                <div class="upcoming-meta">

                  ${esc(p.platform)}
                  ·
                  ${esc(p.format)}

                  ${
                    p.publication_time
                      ? " · " +
                        esc(
                          p.publication_time
                            .slice(0,5)
                        )
                      : ""
                  }

                </div>

              </div>


              <div class="assignee-mini">
                ${avatars}
              </div>


              <span class="chevron">
                ›
              </span>

            </button>

          `;

        }
      )
      .join("");


  box
    .querySelectorAll(
      "[data-pub]"
    )
    .forEach(
      button => {

        button.onclick =
          () => {

            const p =
              publications.find(
                x =>
                  x.id ===
                  button.dataset.pub
              );


            if(p){

              openModal(
                p.content_id
              );

            }

          };

      }
    );

}


/* =========================================================
   ОТВЕТСТВЕННЫЕ
========================================================= */

function publicationAssignees(
  pubId
){

  return assigneeRows
    .filter(
      x =>
        x.publication_id ===
        pubId
    )
    .map(
      x =>
        members.find(
          m =>
            m.id ===
            x.user_id
        )
    )
    .filter(Boolean);

}


/* =========================================================
   КОНТЕНТ
========================================================= */

function renderContent(){

  const box =
    $("contentList");


  const search =
    (
      $("contentSearch")
        ?.value ||
      ""
    )
      .trim()
      .toLowerCase();


  const platform =
    $("contentPlatformFilter")
      ?.value ||
    "all";


  const filteredContents =
    contents.filter(
      c => {

        const pubs =
          publications.filter(
            p =>
              p.content_id ===
              c.id
          );


        const text =
          `
          ${c.title || ""}
          ${c.description || ""}
          ${pubs
            .map(
              p =>
                `
                ${p.title}
                ${p.platform}
                ${p.format}
                `
            )
            .join(" ")}
          `
            .toLowerCase();


        const matchesSearch =
          !search ||
          text.includes(
            search
          );


        const matchesPlatform =
          platform === "all" ||
          pubs.some(
            p =>
              p.platform ===
              platform
          );


        return (
          matchesSearch &&
          matchesPlatform
        );

      }
    );


  if(
    !filteredContents.length
  ){

    box.innerHTML = `

      <div class="empty">

        ${
          contents.length
            ? "По этому запросу ничего не найдено."
            : "Контента пока нет. Нажми «+ Контент», чтобы добавить."
        }

      </div>

    `;

    return;

  }


  box.innerHTML =
    filteredContents
      .map(
        c => {

          const pubs =
            publications
              .filter(
                p =>
                  p.content_id ===
                  c.id
              )
              .sort(
                sortPublication
              );


          return `

            <button
              class="content-card"
              data-content="${c.id}"
              type="button"
            >

              <div class="content-main">

                <div class="content-title">
                  ${esc(c.title)}
                </div>


                <div class="content-meta">

                  ${pubs.length}

                  ${
                    plural(
                      pubs.length,
                      "публикация",
                      "публикации",
                      "публикаций"
                    )
                  }

                  ${
                    c.description
                      ? " · " +
                        esc(
                          c.description
                        )
                      : ""
                  }

                </div>

              </div>


              <div class="content-right">

                ${
                  pubs
                    .slice(0,4)
                    .map(
                      p => `

                        <span
                          class="mini-chip"
                        >
                          ${esc(p.platform)}
                          ·
                          ${esc(p.format)}
                        </span>

                      `
                    )
                    .join("")
                }

              </div>

            </button>

          `;

        }
      )
      .join("");


  box
    .querySelectorAll(
      "[data-content]"
    )
    .forEach(
      button => {

        button.onclick =
          () =>
            openModal(
              button.dataset.content
            );

      }
    );

}


/* =========================================================
   КОМАНДА
========================================================= */

function renderTeam(){

  const box =
    $("teamList");


  $("teamCount")
    .textContent =
      `${members.length} ${
        plural(
          members.length,
          "участник",
          "участника",
          "участников"
        )
      }`;


  if(
    !members.length
  ){

    box.innerHTML = `

      <div class="empty">

        Участники появятся здесь
        после входа через Telegram.

      </div>

    `;

    return;

  }


  box.innerHTML =
    members
      .map(
        m => `

          <div class="team-card">

            ${avatarHtml(m)}

            <div>

              <div class="team-name">

                ${
                  esc(
                    m.telegram_first_name ||
                    "Без имени"
                  )
                }

              </div>


              <div class="team-handle">

                ${
                  m.telegram_username
                    ? "@" +
                      esc(
                        m.telegram_username
                      )
                    : "Telegram"
                }

              </div>

            </div>

          </div>

        `
      )
      .join("");

}


/* =========================================================
   АНАЛИТИКА
========================================================= */

function renderAnalytics(){

  const list =
    analyticsPeriod();


  $("statTotal")
    .textContent =
      list.length;


  const days =
    activePeriod === "week"
      ? 7

      : activePeriod === "month"
        ? 30

        : activePeriod === "3months"
          ? 90

          : Math.max(
              1,
              daysBetween(
                minDate(list),
                maxDate(list)
              ) + 1
            );


  $("statWeek")
    .textContent =
      (
        (list.length / days) *
        7
      ).toFixed(1);


  renderBars(
    "platformStats",
    countBy(
      list,
      "platform"
    )
  );


  renderBars(
    "formatStats",
    countBy(
      list,
      "format"
    )
  );


  const weekdays = {};


  list.forEach(
    p => {

      const d =
        new Date(
          `${p.publication_date}T12:00:00`
        );


      const key =
        [
          "Вс",
          "Пн",
          "Вт",
          "Ср",
          "Чт",
          "Пт",
          "Сб"
        ][
          d.getDay()
        ];


      weekdays[key] =
        (
          weekdays[key] ||
          0
        ) + 1;

    }
  );


  renderBars(
    "weekdayStats",
    weekdays
  );


  const workload = {};


  list.forEach(
    p => {

      publicationAssignees(
        p.id
      )
        .forEach(
          m => {

            const key =
              m.telegram_first_name ||
              m.telegram_username ||
              "Участник";


            workload[key] =
              (
                workload[key] ||
                0
              ) + 1;

          }
        );

    }
  );


  renderBars(
    "assigneeStats",
    workload
  );

}


function analyticsPeriod(){

  const now =
    new Date();


  let from = null;


  if(
    activePeriod ===
    "week"
  ){

    from =
      new Date(
        now.getTime() -
        6 * 86400000
      );

  }


  if(
    activePeriod ===
    "month"
  ){

    from =
      new Date(
        now.getTime() -
        29 * 86400000
      );

  }


  if(
    activePeriod ===
    "3months"
  ){

    from =
      new Date(
        now.getTime() -
        89 * 86400000
      );

  }


  const platform =
    $("analyticsPlatform")
      ?.value ||
    "all";


  return publications.filter(
    p => {

      const d =
        new Date(
          `${p.publication_date}T12:00:00`
        );


      const inPeriod =
        !from ||
        d >= from;


      const inPlatform =
        platform === "all" ||
        p.platform ===
          platform;


      return (
        inPeriod &&
        inPlatform
      );

    }
  );

}


function countBy(
  list,
  key
){

  return list.reduce(
    (
      result,
      item
    ) => {

      result[item[key]] =
        (
          result[item[key]] ||
          0
        ) + 1;


      return result;

    },
    {}
  );

}


function renderBars(
  id,
  obj
){

  const box =
    $(id);


  const entries =
    Object.entries(
      obj
    ).sort(
      (a,b) =>
        b[1] -
        a[1]
    );


  const max =
    entries[0]?.[1] ||
    1;


  if(!entries.length){

    box.innerHTML = `

      <div
        class="empty"
        style="padding:18px;margin-top:12px"
      >
        Нет данных
      </div>

    `;

    return;

  }


  box.innerHTML = `

    <div class="bars">

      ${
        entries
          .map(
            ([name,n]) => `

              <div class="bar-row">

                <span>
                  ${esc(name)}
                </span>

                <div class="bar-track">

                  <div
                    class="bar-fill"
                    style="
                      width:${Math.max(
                        4,
                        n / max * 100
                      )}%
                    "
                  ></div>

                </div>

                <strong>
                  ${n}
                </strong>

              </div>

            `
          )
          .join("")
      }

    </div>

  `;

}


/* =========================================================
   ВСПОМОГАТЕЛЬНЫЕ
========================================================= */

function sortPublication(
  a,
  b
){

  const aa =
    `${a.publication_date}T${
      a.publication_time ||
      "23:59:59"
    }`;


  const bb =
    `${b.publication_date}T${
      b.publication_time ||
      "23:59:59"
    }`;


  return aa.localeCompare(
    bb
  );

}


function minDate(
  list
){

  if(!list.length){
    return isoToday();
  }


  return list.reduce(
    (a,p) =>
      a < p.publication_date
        ? a
        : p.publication_date,
    list[0].publication_date
  );

}


function maxDate(
  list
){

  if(!list.length){
    return isoToday();
  }


  return list.reduce(
    (a,p) =>
      a > p.publication_date
        ? a
        : p.publication_date,
    list[0].publication_date
  );

}


function daysBetween(
  a,
  b
){

  return Math.round(
    (
      new Date(b) -
      new Date(a)
    ) / 86400000
  );

}


function plural(
  n,
  one,
  few,
  many
){

  const last =
    n % 10;

  const lastTwo =
    n % 100;


  if(
    last === 1 &&
    lastTwo !== 11
  ){

    return one;

  }


  if(
    last >= 2 &&
    last <= 4 &&
    (
      lastTwo < 12 ||
      lastTwo > 14
    )
  ){

    return few;

  }


  return many;

}


/* =========================================================
   МОДАЛЬНОЕ ОКНО КОНТЕНТА
========================================================= */

function openModal(
  contentId = null,
  presetDate = null
){

  $("modal")
    .classList
    .remove("hidden");


  $("editingContentId")
    .value =
      contentId ||
      "";


  $("modalTitle")
    .textContent =
      contentId
        ? "Редактировать контент"
        : "Новый контент";


  $("deleteContentBtn")
    .classList
    .toggle(
      "hidden",
      !contentId
    );


  $("contentTitle")
    .value =
      "";


  $("contentDescription")
    .value =
      "";


  $("publicationEditorList")
    .innerHTML =
      "";


  if(contentId){

    const content =
      contents.find(
        c =>
          c.id ===
          contentId
      );


    if(content){

      $("contentTitle")
        .value =
          content.title ||
          "";


      $("contentDescription")
        .value =
          content.description ||
          "";

    }


    publications
      .filter(
        p =>
          p.content_id ===
          contentId
      )
      .sort(
        sortPublication
      )
      .forEach(
        p =>
          addPublicationEditor(
            p
          )
      );

  }
  else{

    addPublicationEditor(
      null,
      presetDate
    );

  }

}


function closeModal(){

  $("modal")
    .classList
    .add("hidden");

}


/* =========================================================
   РЕДАКТОР ПУБЛИКАЦИИ
========================================================= */

function addPublicationEditor(
  data = null,
  presetDate = null
){

  const template =
    $("publicationTemplate");


  const node =
    template.content
      .firstElementChild
      .cloneNode(
        true
      );


  node.dataset.existingId =
    data?.id ||
    "";


  const fields =
    node.querySelectorAll(
      "[data-field]"
    );


  const defaults = {

    title:"",

    platform:
      "Telegram",

    format:
      "Пост",

    date:
      presetDate ||
      isoToday(),

    time:"",

    status:
      "planned",

    link:"",

    description:""

  };


  fields.forEach(
    field => {

      const name =
        field.dataset.field;


      field.value =
        data?.[name] ??
        defaults[name];

    }
  );


  node
    .querySelector(
      '[data-reminder="24h"]'
    )
    .checked =
      data
        ? !!data.reminder_24h
        : true;


  node
    .querySelector(
      '[data-reminder="3h"]'
    )
    .checked =
      data
        ? !!data.reminder_3h
        : false;


  node
    .querySelector(
      '[data-reminder="1h"]'
    )
    .checked =
      data
        ? !!data.reminder_1h
        : false;


  const selected =
    new Set(
      data

        ? assigneeRows
            .filter(
              x =>
                x.publication_id ===
                data.id
            )
            .map(
              x =>
                x.user_id
            )

        : []
    );


  node._selected =
    selected;


  function renderPicker(){

    const search =
      (
        node
          .querySelector(
            "[data-search]"
          )
          .value ||
        ""
      )
        .toLowerCase()
        .trim();


    const options =
      node.querySelector(
        "[data-options]"
      );


    const filtered =
      members.filter(
        member => {

          const name =
            (
              member.telegram_first_name ||
              ""
            )
              .toLowerCase();


          const username =
            (
              member.telegram_username ||
              ""
            )
              .toLowerCase();


          return (
            !search ||
            name.includes(search) ||
            username.includes(search)
          );

        }
      );


    options.innerHTML = `

      <div class="assignee-options">

        ${
          filtered.length

            ? filtered
                .map(
                  member => `

                    <label
                      class="assignee-option"
                    >

                      <input
                        type="checkbox"
                        data-user="${member.id}"
                        ${
                          selected.has(
                            member.id
                          )
                            ? "checked"
                            : ""
                        }
                      >

                      <span>

                        ${
                          esc(
                            member.telegram_first_name ||
                            "Без имени"
                          )
                        }

                        ${
                          member.telegram_username
                            ? " · @" +
                              esc(
                                member.telegram_username
                              )
                            : ""
                        }

                      </span>

                    </label>

                  `
                )
                .join("")

            : `
                <div
                  style="
                    padding:10px 4px;
                    color:#999;
                    font-size:11px
                  "
                >
                  Никого не найдено
                </div>
              `

        }

      </div>

    `;


    options
      .querySelectorAll(
        "[data-user]"
      )
      .forEach(
        checkbox => {

          checkbox.addEventListener(
            "change",
            () => {

              if(
                checkbox.checked
              ){

                selected.add(
                  checkbox.dataset.user
                );

              }
              else{

                selected.delete(
                  checkbox.dataset.user
                );

              }


              renderPicker();

            }
          );

        }
      );


    const selectedBox =
      node.querySelector(
        "[data-selected]"
      );


    selectedBox.innerHTML =
      [...selected]
        .map(
          id =>
            members.find(
              member =>
                member.id ===
                id
            )
        )
        .filter(Boolean)
        .map(
          member => `

            <span class="assignee-tag">

              ${esc(
                member.telegram_first_name ||
                "Участник"
              )}

              <button
                type="button"
                data-remove="${member.id}"
              >
                ×
              </button>

            </span>

          `
        )
        .join("");


    selectedBox
      .querySelectorAll(
        "[data-remove]"
      )
      .forEach(
        button => {

          button.onclick =
            () => {

              selected.delete(
                button.dataset.remove
              );


              renderPicker();

            };

        }
      );

  }


  node
    .querySelector(
      "[data-search]"
    )
    .addEventListener(
      "input",
      renderPicker
    );


  renderPicker();


  node
    .querySelector(
      ".remove-publication"
    )
    .onclick =
      () => {

        const count =
          document.querySelectorAll(
            "[data-publication]"
          ).length;


        if(count <= 1){

          toast(
            "Должна остаться хотя бы одна публикация"
          );

          return;

        }


        node.remove();

        renumberEditors();

      };


  $("publicationEditorList")
    .appendChild(
      node
    );


  renumberEditors();

}


function renumberEditors(){

  document
    .querySelectorAll(
      "[data-publication] .pub-number"
    )
    .forEach(
      (
        element,
        index
      ) => {

        element.textContent =
          `Публикация ${
            index + 1
          }`;

      }
    );

}


/* =========================================================
   СОХРАНЕНИЕ
========================================================= */

async function saveContent(
  event
){

  event.preventDefault();


  if(!currentProject){
    return;
  }


  const contentId =
    $("editingContentId")
      .value ||
    null;


  const title =
    $("contentTitle")
      .value
      .trim();


  if(!title){

    toast(
      "Введите название контента"
    );

    return;

  }


  let savedContent;


  if(contentId){

    const {
      data,
      error
    } =
      await db
        .from("content")
        .update(
          {
            title,

            description:
              $("contentDescription")
                .value
                .trim()
          }
        )
        .eq(
          "id",
          contentId
        )
        .select()
        .single();


    if(error){
      throw error;
    }


    savedContent =
      data;

  }
  else{

    const {
      data,
      error
    } =
      await db
        .from("content")
        .insert(
          {
            project_id:
              currentProject.id,

            title,

            description:
              $("contentDescription")
                .value
                .trim(),

            created_by:
              currentUser.id
          }
        )
        .select()
        .single();


    if(error){
      throw error;
    }


    savedContent =
      data;

  }


  const editors =
    [
      ...document.querySelectorAll(
        "[data-publication]"
      )
    ];


  const keptIds =
    [];


  for(
    const node of editors
  ){

    const get =
      field =>
        node
          .querySelector(
            `[data-field="${field}"]`
          )
          .value;


    const payload = {

      content_id:
        savedContent.id,

      project_id:
        currentProject.id,

      title:
        get("title")
          .trim(),

      platform:
        get("platform"),

      format:
        get("format"),

      publication_date:
        get("date"),

      publication_time:
        get("time") ||
        null,

      status:
        get("status"),

      link:
        get("link")
          .trim() ||
        null,

      description:
        get("description")
          .trim() ||
        null,

      reminder_24h:
        node.querySelector(
          '[data-reminder="24h"]'
        ).checked,

      reminder_3h:
        node.querySelector(
          '[data-reminder="3h"]'
        ).checked,

      reminder_1h:
        node.querySelector(
          '[data-reminder="1h"]'
        ).checked

    };


    if(!payload.title){

      toast(
        "У каждой публикации должно быть название"
      );

      throw new Error(
        "Пустое название публикации"
      );

    }


    const existingId =
      node.dataset.existingId;


    let publication;
    let error;


    if(existingId){

      ({
        data:publication,
        error
      } =
        await db
          .from("publications")
          .update(
            payload
          )
          .eq(
            "id",
            existingId
          )
          .select()
          .single());

    }
    else{

      ({
        data:publication,
        error
      } =
        await db
          .from("publications")
          .insert(
            payload
          )
          .select()
          .single());

    }


    if(error){
      throw error;
    }


    keptIds.push(
      publication.id
    );


    const selected =
      [
        ...node._selected
      ];


    const {
      error:deleteError
    } =
      await db
        .from(
          "publication_assignees"
        )
        .delete()
        .eq(
          "publication_id",
          publication.id
        );


    if(deleteError){
      throw deleteError;
    }


    if(selected.length){

      const rows =
        selected.map(
          user_id => ({
            publication_id:
              publication.id,

            user_id
          })
        );


      const {
        error:insertError
      } =
        await db
          .from(
            "publication_assignees"
          )
          .insert(
            rows
          );


      if(insertError){
        throw insertError;
      }

    }

  }


  if(contentId){

    const removed =
      publications
        .filter(
          p =>
            p.content_id ===
              contentId &&

            !keptIds.includes(
              p.id
            )
        )
        .map(
          p =>
            p.id
        );


    if(removed.length){

      const {
        error
      } =
        await db
          .from(
            "publications"
          )
          .delete()
          .in(
            "id",
            removed
          );


      if(error){
        throw error;
      }

    }

  }


  closeModal();


  await loadContent();

  renderEverything();


  toast(
    "Сохранено"
  );

}


/* =========================================================
   УДАЛЕНИЕ
========================================================= */

async function deleteContent(){

  const id =
    $("editingContentId")
      .value;


  if(!id){
    return;
  }


  if(
    !confirm(
      "Удалить этот контент и все его публикации?"
    )
  ){

    return;

  }


  const {
    error
  } =
    await db
      .from("content")
      .delete()
      .eq(
        "id",
        id
      );


  if(error){

    console.error(error);

    toast(
      "Не удалось удалить"
    );

    return;

  }


  closeModal();

  await loadContent();

  renderEverything();


  toast(
    "Удалено"
  );

}


/* =========================================================
   КНОПКИ
========================================================= */

$("prevMonth")
  ?.addEventListener(
    "click",
    () => {

      currentMonth =
        new Date(
          currentMonth.getFullYear(),
          currentMonth.getMonth() - 1,
          1
        );


      renderCalendar();

    }
  );


$("nextMonth")
  ?.addEventListener(
    "click",
    () => {

      currentMonth =
        new Date(
          currentMonth.getFullYear(),
          currentMonth.getMonth() + 1,
          1
        );


      renderCalendar();

    }
  );


$("todayBtn")
  ?.addEventListener(
    "click",
    () => {

      currentMonth =
        new Date();


      renderCalendar();

    }
  );


/*
  Главная кнопка +
*/

$("addPublicationTop")
  ?.addEventListener(
    "click",
    () => {

      openModal(
        null,
        isoToday()
      );

    }
  );


/*
  + Контент
*/

$("addContentInline")
  ?.addEventListener(
    "click",
    () => {

      openModal();

    }
  );


/*
  + Публикация
  внутри контента
*/

$("addPublication")
  ?.addEventListener(
    "click",
    () => {

      addPublicationEditor();

    }
  );


/*
  + Публикация
  из окна конкретного дня
*/

$("addPublicationForDay")
  ?.addEventListener(
    "click",
    () => {

      const date =
        $("addPublicationForDay")
          .dataset
          .date ||
        isoToday();


      closeDayDetails();


      openModal(
        null,
        date
      );

    }
  );


/*
  Закрытие окна дня
*/

document
  .querySelectorAll(
    "[data-close-day]"
  )
  .forEach(
    element =>
      element.addEventListener(
        "click",
        closeDayDetails
      )
  );


/*
  Закрытие окна контента
*/

document
  .querySelectorAll(
    "[data-close-modal]"
  )
  .forEach(
    element =>
      element.addEventListener(
        "click",
        closeModal
      )
  );


/*
  Сохранение
*/

$("contentForm")
  ?.addEventListener(
    "submit",
    event => {

      saveContent(
        event
      )
        .catch(
          error => {

            console.error(
              error
            );

            toast(
              error.message ||
              "Ошибка сохранения"
            );

          }
        );

    }
  );


/*
  Удаление контента
*/

$("deleteContentBtn")
  ?.addEventListener(
    "click",
    deleteContent
  );


/*
  Нижняя навигация
*/

document
  .querySelectorAll(
    ".nav-item"
  )
  .forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          switchView(
            button.dataset.view
          );

        }
      );

    }
  );


/*
  Все публикации
*/

$("showAllContent")
  ?.addEventListener(
    "click",
    () =>
      switchView(
        "contentView"
      )
  );


/*
  Поиск
*/

$("contentSearch")
  ?.addEventListener(
    "input",
    renderContent
  );


/*
  Фильтр контента
*/

$("contentPlatformFilter")
  ?.addEventListener(
    "change",
    renderContent
  );


/*
  Фильтры аналитики
*/

document
  .querySelectorAll(
    ".filter-btn"
  )
  .forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          activePeriod =
            button.dataset.period;


          document
            .querySelectorAll(
              ".filter-btn"
            )
            .forEach(
              item =>
                item.classList.toggle(
                  "active",
                  item ===
                  button
                )
            );


          renderAnalytics();

        }
      );

    }
  );


$("analyticsPlatform")
  ?.addEventListener(
    "change",
    renderAnalytics
  );


/* =========================================================
   ЗАПУСК
========================================================= */

boot();
