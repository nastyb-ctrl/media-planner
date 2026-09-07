const SUPABASE_URL = "https://vkvrwayzqrlsfsgjjwpy.supabase.co";
const SUPABASE_KEY = "sb_publishable_-kj7hiC7uou3db2wpwFM_w_jgXQNpnb";

const { createClient } = supabase;

const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});

const tg = window.Telegram?.WebApp;

let currentUser = null;
let currentProfile = null;
let currentProject = null;

let members = [];
let contents = [];
let publications = [];
let assigneeRows = [];

let currentMonth = new Date();
let activePeriod = "month";

let saving = false;
let memberPoll = null;
let plannerPoll = null;
let realtimeChannels = [];

let selectedDayForNewPublication = null;

const $ = id => document.getElementById(id);

const esc = value =>
  String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[c]));

const pad = n => String(n).padStart(2, "0");

const isoToday = () => {
  const d = new Date();

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

function plural(n, one, few, many) {
  const m = n % 10;
  const t = n % 100;

  if (m === 1 && t !== 11) return one;

  if (
    m >= 2 &&
    m <= 4 &&
    (t < 12 || t > 14)
  ) {
    return few;
  }

  return many;
}

function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDate(date) {
  if (!date) return "";

  const [y, m, d] = date.split("-").map(Number);

  return `${d} ${shortMonths[m - 1]}`;
}

function platformClass(platform) {
  return String(platform || "")
    .toLowerCase()
    .replace(/[^a-zа-яё]/gi, "");
}

function statusLabel(status) {
  if (status === "progress") return "В работе";
  if (status === "done") return "Готово";

  return "Запланировано";
}

function sortPublication(a, b) {
  const aa =
    `${a.publication_date}T${a.publication_time || "23:59:59"}`;

  const bb =
    `${b.publication_date}T${b.publication_time || "23:59:59"}`;

  return aa.localeCompare(bb);
}

function toast(text) {
  document.querySelector(".toast")?.remove();

  const el = document.createElement("div");

  el.className = "toast";

  Object.assign(el.style, {
    position: "fixed",
    left: "50%",
    bottom: "90px",
    transform: "translateX(-50%)",
    zIndex: "300",
    padding: "11px 15px",
    borderRadius: "12px",
    background: "#171717",
    color: "#fff",
    fontSize: "13px",
    boxShadow: "0 10px 30px rgba(0,0,0,.18)",
    maxWidth: "calc(100vw - 32px)",
    textAlign: "center"
  });

  el.textContent = text;

  document.body.appendChild(el);

  setTimeout(() => el.remove(), 2200);
}

function avatarHtml(profile) {
  const name =
    profile?.telegram_first_name ||
    profile?.telegram_username ||
    "?";

  const initials = name.slice(0, 2).toUpperCase();

  if (profile?.telegram_photo_url) {
    return `
      <img
        class="team-avatar"
        src="${esc(profile.telegram_photo_url)}"
        alt=""
      >
    `;
  }

  return `
    <div class="team-avatar-placeholder">
      ${esc(initials)}
    </div>
  `;
}

function telegramInitData() {
  return tg?.initData || "";
}

/* =========================
   START
========================= */

async function boot() {
  try {
    tg?.ready();
    tg?.expand();

    tg?.enableClosingConfirmation?.();

    tg?.setHeaderColor?.("#f7f7f5");
    tg?.setBackgroundColor?.("#f7f7f5");

    /*
      Получаем существующую Supabase-сессию.
      Если её нет — создаём техническую анонимную сессию.
    */

    let session =
      (await db.auth.getSession()).data.session;

    if (!session) {
      const { error } =
        await db.auth.signInAnonymously();

      if (error) {
        throw error;
      }

      session =
        (await db.auth.getSession()).data.session;
    }

    currentUser = session?.user;

    if (!currentUser) {
      throw new Error(
        "Не удалось создать рабочую сессию."
      );
    }

    /*
      Telegram-авторизация.

      ВАЖНО:
      если Telegram Desktop / WebView временно
      возвращает ошибку Edge Function, приложение
      НЕ падает.

      На телефоне нормальная Telegram-авторизация
      продолжает работать.
    */

    const initData = telegramInitData();

    if (initData) {
      try {
        const { error } =
          await db.functions.invoke(
            "telegram-auth",
            {
              body: {
                initData
              }
            }
          );

        if (error) {
          console.warn(
            "Telegram auth fallback:",
            error
          );
        }
      } catch (authError) {
        console.warn(
          "Telegram auth fallback:",
          authError
        );
      }
    }

    await loadProfile();

    await ensureProject();

    await loadAll();

    setupRealtime();

    startPolling();

    bindEvents();

    showApp();

  } catch (error) {
    console.error(error);

    showAuthError(
      error?.message ||
      "Не удалось открыть планер"
    );
  }
}

/* =========================
   PROFILE
========================= */

async function loadProfile() {
  const {
    data,
    error
  } = await db
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  currentProfile =
    data || {
      id: currentUser.id,
      telegram_first_name: "Участник"
    };
}

/* =========================
   PROJECT
========================= */

async function ensureProject() {
  /*
    Используем RPC, который сам получает
    общий проект команды и добавляет пользователя
    в project_members.
  */

  const {
    data,
    error
  } = await db.rpc(
    "get_default_project_for_user"
  );

  if (error) {
    throw error;
  }

  currentProject =
    Array.isArray(data)
      ? data[0]
      : data;

  if (!currentProject) {
    throw new Error(
      "Не найден проект команды."
    );
  }
}

/* =========================
   LOAD EVERYTHING
========================= */

async function loadAll() {
  await Promise.all([
    loadMembers(),
    loadContent()
  ]);

  renderEverything();
}

/* =========================
   MEMBERS
========================= */

async function loadMembers() {
  const {
    data,
    error
  } = await db
    .from("profiles")
    .select(`
      id,
      telegram_id,
      telegram_username,
      telegram_first_name,
      telegram_photo_url
    `)
    .not(
      "telegram_id",
      "is",
      null
    )
    .order(
      "telegram_first_name",
      {
        ascending: true
      }
    );

  if (error) {
    console.warn(
      "members:",
      error
    );

    members =
      currentProfile
        ? [currentProfile]
        : [];

    return;
  }

  members = data || [];

  if (
    currentProfile &&
    currentProfile.telegram_id &&
    !members.some(
      m => m.id === currentProfile.id
    )
  ) {
    members.unshift(
      currentProfile
    );
  }
}

/* =========================
   CONTENT
========================= */

async function loadContent() {
  if (!currentProject) {
    return;
  }

  const {
    data: c,
    error: ce
  } = await db
    .from("content")
    .select("*")
    .eq(
      "project_id",
      currentProject.id
    )
    .order(
      "created_at",
      {
        ascending: false
      }
    );

  if (ce) {
    throw ce;
  }

  const {
    data: p,
    error: pe
  } = await db
    .from("publications")
    .select("*")
    .eq(
      "project_id",
      currentProject.id
    )
    .order(
      "publication_date",
      {
        ascending: true
      }
    )
    .order(
      "publication_time",
      {
        ascending: true,
        nullsFirst: false
      }
    );

  if (pe) {
    throw pe;
  }

  const ids =
    (p || []).map(
      x => x.id
    );

  let a = [];

  if (ids.length) {
    const {
      data,
      error
    } = await db
      .from("publication_assignees")
      .select(
        "publication_id,user_id"
      )
      .in(
        "publication_id",
        ids
      );

    if (error) {
      throw error;
    }

    a = data || [];
  }

  contents = c || [];

  publications = p || [];

  assigneeRows = a;
}

/* =========================
   REALTIME
========================= */

function setupRealtime() {
  realtimeChannels.forEach(
    channel => db.removeChannel(channel)
  );

  realtimeChannels = [];

  [
    "content",
    "publications",
    "publication_assignees"
  ].forEach(table => {

    const channel =
      db
        .channel(
          `planner-${table}`
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table
          },
          async () => {
            try {
              await loadContent();

              renderEverything();

            } catch (error) {
              console.warn(
                "Realtime refresh:",
                error
              );
            }
          }
        )
        .subscribe();

    realtimeChannels.push(
      channel
    );
  });
}

/* =========================
   POLLING
========================= */

function startPolling() {
  clearInterval(memberPoll);
  clearInterval(plannerPoll);

  /*
    Обновляем участников каждые 15 секунд.
  */

  memberPoll =
    setInterval(
      async () => {
        try {
          await loadMembers();

          renderTeam();

        } catch (error) {
          console.warn(
            "Members refresh:",
            error
          );
        }
      },
      15000
    );

  /*
    Обновляем контент каждые 15 секунд.
    Это дополнительно гарантирует,
    что у всей команды данные будут актуальными,
    даже если Realtime временно не сработал.
  */

  plannerPoll =
    setInterval(
      async () => {
        try {
          await loadContent();

          renderEverything();

        } catch (error) {
          console.warn(
            "Planner refresh:",
            error
          );
        }
      },
      15000
    );
}

/* =========================
   APP
========================= */

function showApp() {
  $("authScreen")
    ?.classList
    .add("hidden");

  $("mainScreen")
    ?.classList
    .remove("hidden");

  switchView(
    "calendarView"
  );
}

function showAuthError(message) {
  const card =
    document.querySelector(
      ".auth-card"
    );

  if (!card) {
    return;
  }

  card.innerHTML = `
    <div class="auth-logo">!</div>
    <h1>Не удалось открыть</h1>
    <p>${esc(message)}</p>
  `;
}

/* =========================
   RENDER
========================= */

function renderEverything() {
  renderCalendar();
  renderUpcoming();
  renderContent();
  renderTeam();
  renderAnalytics();
}

/* =========================
   VIEWS
========================= */

function switchView(viewId) {
  document
    .querySelectorAll(".view")
    .forEach(view => {
      view.classList.toggle(
        "hidden",
        view.id !== viewId
      );
    });

  document
    .querySelectorAll(".nav-button")
    .forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.view === viewId
      );
    });

  window.scrollTo({
    top: 0,
    behavior: "instant"
  });
}

/* =========================
   CALENDAR
========================= */

function renderCalendar() {
  const grid =
    $("calendarGrid");

  if (!grid) {
    return;
  }

  const year =
    currentMonth.getFullYear();

  const month =
    currentMonth.getMonth();

  const monthLabel =
    $("monthLabel") ||
    $("currentMonth");

  if (monthLabel) {
    monthLabel.textContent =
      `${monthNames[month]} ${year}`;
  }

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

  const leading =
    (first.getDay() + 6) % 7;

  const total =
    Math.ceil(
      (leading + daysInMonth) / 7
    ) * 7;

  grid.innerHTML = "";

  for (
    let i = 0;
    i < total;
    i++
  ) {

    const day =
      i - leading + 1;

    const dateObj =
      new Date(
        year,
        month,
        day
      );

    const date =
      toISO(dateObj);

    const cell =
      document.createElement(
        "div"
      );

    cell.className =
      "calendar-cell";

    if (
      dateObj.getMonth() !==
      month
    ) {
      cell.classList.add(
        "other-month"
      );
    }

    if (
      date === isoToday()
    ) {
      cell.classList.add(
        "today"
      );
    }

    cell.innerHTML = `
      <div class="calendar-date">
        <span class="calendar-date-number">
          ${dateObj.getDate()}
        </span>
      </div>

      <div class="calendar-publications"></div>
    `;

    cell.addEventListener(
      "click",
      () =>
        openDayDetails(date)
    );

    const list =
      publications
        .filter(
          p =>
            p.publication_date ===
            date
        )
        .sort(
          sortPublication
        );

    const box =
      cell.querySelector(
        ".calendar-publications"
      );

    list
      .slice(0, 3)
      .forEach(p => {

        const chip =
          document.createElement(
            "button"
          );

        chip.type = "button";

        chip.className =
          "publication-chip";

        chip.innerHTML = `
          <div class="publication-chip-title">
            ${esc(p.title)}
          </div>

          <div class="publication-chip-platform">
            ${esc(p.platform)}
            ${
              p.publication_time
                ? " · " +
                  esc(
                    p.publication_time.slice(
                      0,
                      5
                    )
                  )
                : ""
            }
          </div>
        `;

        chip.addEventListener(
          "click",
          event => {
            event.stopPropagation();

            openModal(
              p.content_id
            );
          }
        );

        box.appendChild(
          chip
        );
      });

    if (list.length > 3) {

      const more =
        document.createElement(
          "button"
        );

      more.type = "button";

      more.className =
        "more-publications";

      more.textContent =
        `+ ещё ${list.length - 3}`;

      more.addEventListener(
        "click",
        event => {
          event.stopPropagation();

          openDayDetails(
            date
          );
        }
      );

      box.appendChild(
        more
      );
    }

    grid.appendChild(
      cell
    );
  }
}

/* =========================
   DAY MODAL
========================= */

function openDayDetails(date) {
  selectedDayForNewPublication =
    date;

  const modal =
    $("dayModal");

  if (!modal) {
    return;
  }

  const list =
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

  const dateTitle =
    $("dayModalDate");

  if (dateTitle) {
    dateTitle.textContent =
      `${d.getDate()} ${
        shortMonths[d.getMonth()]
      } ${d.getFullYear()}`;
  }

  const box =
    $("dayPublications");

  if (!box) {
    return;
  }

  box.innerHTML =
    list.length
      ? list
          .map(
            p => `
              <button
                type="button"
                class="day-publication"
                data-day-pub="${p.id}"
              >

                <div class="day-publication-title">
                  ${esc(p.title)}
                </div>

                <div class="day-publication-meta">

                  <span>
                    ${esc(p.platform)}
                  </span>

                  <span>
                    ${esc(p.format)}
                  </span>

                  ${
                    p.publication_time
                      ? `
                        <span>
                          ${esc(
                            p.publication_time.slice(
                              0,
                              5
                            )
                          )}
                        </span>
                      `
                      : ""
                  }

                  <span>
                    ${statusLabel(
                      p.status
                    )}
                  </span>

                </div>

              </button>
            `
          )
          .join("")
      : `
        <div class="empty-state">
          На этот день публикаций нет.
        </div>
      `;

  box
    .querySelectorAll(
      "[data-day-pub]"
    )
    .forEach(button => {

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

          if (p) {
            openModal(
              p.content_id
            );
          }
        }
      );
    });

  modal.classList.remove(
    "hidden"
  );

  requestAnimationFrame(
    () => {
      modal
        .querySelector(
          ".modal-sheet"
        )
        ?.scrollTo({
          top: 0,
          behavior: "instant"
        });
    }
  );
}

function closeDayDetails() {
  $("dayModal")
    ?.classList
    .add("hidden");
}

/* =========================
   UPCOMING
========================= */

function renderUpcoming() {
  const box =
    $("upcomingList");

  if (!box) {
    return;
  }

  const now =
    new Date();

  const list =
    publications
      .filter(p => {

        const dt =
          new Date(
            `${p.publication_date}T${
              p.publication_time ||
              "23:59:59"
            }`
          );

        return dt >= now;
      })
      .sort(
        sortPublication
      )
      .slice(0, 6);

  if (!list.length) {

    box.innerHTML = `
      <div class="empty-state">
        Пока нет запланированных публикаций.
      </div>
    `;

    return;
  }

  box.innerHTML =
    list
      .map(
        p => `
          <button
            type="button"
            class="upcoming-card"
            data-upcoming="${p.id}"
          >

            <div class="upcoming-date">
              ${formatDate(
                p.publication_date
              )}

              ${
                p.publication_time
                  ? " · " +
                    esc(
                      p.publication_time.slice(
                        0,
                        5
                      )
                    )
                  : ""
              }
            </div>

            <div class="upcoming-title">
              ${esc(p.title)}
            </div>

            <div class="upcoming-meta">

              <span class="platform-tag">
                ${esc(p.platform)}
              </span>

              <span class="format-tag">
                ${esc(p.format)}
              </span>

            </div>

          </button>
        `
      )
      .join("");

  box
    .querySelectorAll(
      "[data-upcoming]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const p =
            publications.find(
              x =>
                x.id ===
                button.dataset.upcoming
            );

          if (p) {
            openModal(
              p.content_id
            );
          }
        }
      );
    });
}

/* =========================
   CONTENT
========================= */

function renderContent() {
  const box =
    $("contentList");

  if (!box) {
    return;
  }

  const search =
    ($("contentSearch")
      ?.value || "")
      .trim()
      .toLowerCase();

  const platform =
    $("platformFilter")
      ?.value || "all";

  const filtered =
    contents.filter(c => {

      const pubs =
        publications.filter(
          p =>
            p.content_id ===
            c.id
        );

      const text = [
        c.title,
        c.description,
        ...pubs.flatMap(
          p => [
            p.title,
            p.platform,
            p.format,
            p.description
          ]
        )
      ]
        .join(" ")
        .toLowerCase();

      return (
        (!search ||
          text.includes(search))
        &&
        (
          platform === "all" ||
          pubs.some(
            p =>
              p.platform ===
              platform
          )
        )
      );
    });

  if (!filtered.length) {

    box.innerHTML = `
      <div class="empty-state">
        ${
          contents.length
            ? "По выбранным фильтрам ничего не найдено."
            : "Контента пока нет. Нажми «+ Контент», чтобы добавить."
        }
      </div>
    `;

    return;
  }

  box.innerHTML =
    filtered
      .map(c => {

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
          <article
            class="content-card"
            data-content="${c.id}"
          >

            <div class="content-card-head">

              <div>

                <div class="content-card-title">
                  ${esc(c.title)}
                </div>

                ${
                  c.description
                    ? `
                      <div class="content-card-description">
                        ${esc(
                          c.description
                        )}
                      </div>
                    `
                    : ""
                }

              </div>

              <span>›</span>

            </div>

            <div class="content-publications">

              ${pubs
                .map(
                  p => `
                    <button
                      type="button"
                      class="content-publication-row"
                      data-publication-id="${p.id}"
                    >

                      <span class="content-publication-date">
                        ${formatDate(
                          p.publication_date
                        )}

                        ${
                          p.publication_time
                            ? " · " +
                              esc(
                                p.publication_time.slice(
                                  0,
                                  5
                                )
                              )
                            : ""
                        }
                      </span>

                      <span class="content-publication-title">
                        ${esc(p.title)}
                      </span>

                      <span class="content-publication-platform">
                        ${esc(p.platform)}
                      </span>

                    </button>
                  `
                )
                .join("")}

            </div>

          </article>
        `;
      })
      .join("");

  box
    .querySelectorAll(
      "[data-content]"
    )
    .forEach(card => {

      card.addEventListener(
        "click",
        event => {

          if (
            event.target.closest(
              "[data-publication-id]"
            )
          ) {
            return;
          }

          openModal(
            card.dataset.content
          );
        }
      );
    });

  box
    .querySelectorAll(
      "[data-publication-id]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        event => {

          event.stopPropagation();

          const p =
            publications.find(
              x =>
                x.id ===
                button.dataset.publicationId
            );

          if (p) {
            openModal(
              p.content_id
            );
          }
        }
      );
    });
}

/* =========================
   TEAM
========================= */

function renderTeam() {
  const box =
    $("teamList");

  if (!box) {
    return;
  }

  if (!members.length) {

    box.innerHTML = `
      <div class="empty-state">
        Участники появятся здесь после входа через Telegram.
      </div>
    `;

    return;
  }

  box.innerHTML =
    members
      .map(
        member => `
          <div class="team-card">

            <div class="team-card-top">

              ${avatarHtml(member)}

              <div>

                <div class="team-name">
                  ${esc(
                    member.telegram_first_name ||
                    "Без имени"
                  )}
                </div>

                <div class="team-username">
                  ${
                    member.telegram_username
                      ? "@" +
                        esc(
                          member.telegram_username
                        )
                      : "Telegram"
                  }
                </div>

              </div>

            </div>

          </div>
        `
      )
      .join("");
}

/* =========================
   ANALYTICS
========================= */

function analyticsPeriod() {
  const now =
    new Date();

  let from = null;

  if (
    activePeriod ===
    "week"
  ) {
    from =
      new Date(
        now.getTime() -
        6 * 86400000
      );
  }

  if (
    activePeriod ===
    "month"
  ) {
    from =
      new Date(
        now.getTime() -
        29 * 86400000
      );
  }

  if (
    activePeriod ===
    "3months"
  ) {
    from =
      new Date(
        now.getTime() -
        89 * 86400000
      );
  }

  const platform =
    $("analyticsPlatform")
      ?.value || "all";

  return publications.filter(
    p => {

      const d =
        new Date(
          `${p.publication_date}T12:00:00`
        );

      return (
        (!from || d >= from)
        &&
        (
          platform === "all" ||
          p.platform ===
          platform
        )
      );
    }
  );
}

function countBy(list, key) {
  return list.reduce(
    (acc, item) => {

      const value =
        item[key] ||
        "Не указано";

      acc[value] =
        (acc[value] || 0) +
        1;

      return acc;

    },
    {}
  );
}

function renderBars(box, obj) {
  if (!box) {
    return;
  }

  const entries =
    Object.entries(obj)
      .sort(
        (a, b) =>
          b[1] - a[1]
      );

  if (!entries.length) {

    box.innerHTML = `
      <div class="empty-state">
        Нет данных
      </div>
    `;

    return;
  }

  const max =
    entries[0][1];

  box.innerHTML =
    entries
      .map(
        ([name, n]) => `
          <div class="analytics-row">

            <span class="analytics-row-label">
              ${esc(name)}
            </span>

            <div class="analytics-bar">

              <div
                class="analytics-bar-fill"
                style="width:${Math.max(
                  5,
                  n / max * 100
                )}%"
              ></div>

            </div>

            <span class="analytics-row-value">
              ${n}
            </span>

          </div>
        `
      )
      .join("");
}

function renderAnalytics() {
  const list =
    analyticsPeriod();

  const total =
    $("analyticsSummary");

  const charts =
    $("analyticsCharts");

  if (!total || !charts) {
    return;
  }

  const days =
    activePeriod === "week"
      ? 7
      : activePeriod === "month"
        ? 30
        : activePeriod === "3months"
          ? 90
          : Math.max(
              1,
              list.length
                ? Math.round(
                    (
                      new Date(
                        maxDate(list)
                      ) -
                      new Date(
                        minDate(list)
                      )
                    ) /
                    86400000
                  ) + 1
                : 1
            );

  const perWeek =
    (
      list.length /
      days *
      7
    ).toFixed(1);

  const assignees = {};

  list.forEach(
    publication => {

      publicationAssignees(
        publication.id
      ).forEach(
        member => {

          const name =
            member.telegram_first_name ||
            member.telegram_username ||
            "Участник";

          assignees[name] =
            (assignees[name] || 0) +
            1;
        }
      );
    }
  );

  const weekdays = {};

  list.forEach(
    publication => {

      const d =
        new Date(
          `${publication.publication_date}T12:00:00`
        );

      const name =
        [
          "Вс",
          "Пн",
          "Вт",
          "Ср",
          "Чт",
          "Пт",
          "Сб"
        ][d.getDay()];

      weekdays[name] =
        (weekdays[name] || 0) +
        1;
    }
  );

  total.innerHTML = `
    <div class="analytics-stat">
      <div class="analytics-stat-value">
        ${list.length}
      </div>

      <div class="analytics-stat-label">
        публикаций
      </div>
    </div>

    <div class="analytics-stat">
      <div class="analytics-stat-value">
        ${perWeek}
      </div>

      <div class="analytics-stat-label">
        в неделю
      </div>
    </div>

    <div class="analytics-stat">
      <div class="analytics-stat-value">
        ${
          Object.keys(
            countBy(
              list,
              "platform"
            )
          ).length
        }
      </div>

      <div class="analytics-stat-label">
        площадок
      </div>
    </div>

    <div class="analytics-stat">
      <div class="analytics-stat-value">
        ${members.length}
      </div>

      <div class="analytics-stat-label">
        участников
      </div>
    </div>
  `;

  charts.innerHTML = `
    <div class="analytics-card">
      <h3>По площадкам</h3>
      <div id="platformChart"></div>
    </div>

    <div class="analytics-card">
      <h3>По форматам</h3>
      <div id="formatChart"></div>
    </div>

    <div class="analytics-card">
      <h3>По дням недели</h3>
      <div id="weekdayChart"></div>
    </div>

    <div class="analytics-card">
      <h3>Нагрузка команды</h3>
      <div id="assigneeChart"></div>
    </div>
  `;

  renderBars(
    $("platformChart"),
    countBy(
      list,
      "platform"
    )
  );

  renderBars(
    $("formatChart"),
    countBy(
      list,
      "format"
    )
  );

  renderBars(
    $("weekdayChart"),
    weekdays
  );

  renderBars(
    $("assigneeChart"),
    assignees
  );
}

function minDate(list) {
  return list.reduce(
    (a, p) =>
      a < p.publication_date
        ? a
        : p.publication_date,
    list[0].publication_date
  );
}

function maxDate(list) {
  return list.reduce(
    (a, p) =>
      a > p.publication_date
        ? a
        : p.publication_date,
    list[0].publication_date
  );
}

/* =========================
   ASSIGNEES
========================= */

function publicationAssignees(pubId) {
  return assigneeRows
    .filter(
      row =>
        row.publication_id ===
        pubId
    )
    .map(
      row =>
        members.find(
          member =>
            member.id ===
            row.user_id
        )
    )
    .filter(Boolean);
}

/* =========================
   CONTENT MODAL
========================= */

function openModal(
  contentId = null,
  presetDate = null
) {
  const modal =
    $("contentModal");

  if (!modal) {
    return;
  }

  modal.classList.remove(
    "hidden"
  );

  $("contentId").value =
    contentId || "";

  $("modalTitle").textContent =
    contentId
      ? "Редактировать контент"
      : "Новый контент";

  $("deleteContentBtn")
    .classList.toggle(
      "hidden",
      !contentId
    );

  $("contentTitle").value =
    "";

  $("contentDescription").value =
    "";

  $("publicationTemplates").innerHTML =
    "";

  if (contentId) {

    const content =
      contents.find(
        item =>
          item.id ===
          contentId
      );

    if (content) {

      $("contentTitle").value =
        content.title || "";

      $("contentDescription").value =
        content.description || "";
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
          addPublicationEditor(p)
      );

  } else {

    addPublicationEditor(
      null,
      presetDate ||
      isoToday()
    );
  }

  requestAnimationFrame(
    () => {

      modal
        .querySelector(
          ".modal-sheet"
        )
        ?.scrollTo({
          top: 0,
          behavior: "instant"
        });
    }
  );
}

function closeModal() {
  $("contentModal")
    ?.classList
    .add("hidden");
}

/* =========================
   PUBLICATION EDITOR
========================= */

function addPublicationEditor(
  data = null,
  presetDate = null
) {
  const wrap =
    $("publicationTemplates");

  if (!wrap) {
    return;
  }

  const node =
    document.createElement(
      "div"
    );

  node.className =
    "publication-template";

  node.dataset.publication =
    "1";

  node.dataset.existingId =
    data?.id || "";

  const selected =
    new Set(
      data
        ? assigneeRows
            .filter(
              row =>
                row.publication_id ===
                data.id
            )
            .map(
              row =>
                row.user_id
            )
        : []
    );

  node.innerHTML = `
    <div class="publication-template-head">

      <div class="publication-template-title pub-number">
        Публикация
      </div>

      <button
        type="button"
        class="remove-publication"
      >
        ×
      </button>

    </div>

    <div class="publication-fields">

      <div class="field full-field">

        <label>
          Название публикации
        </label>

        <input
          data-field="title"
          type="text"
          placeholder="Название"
          value="${esc(
            data?.title || ""
          )}"
        />

      </div>

      <div class="field">

        <label>
          Площадка
        </label>

        <select data-field="platform">

          <option value="Telegram">
            Telegram
          </option>

          <option value="VK">
            VK
          </option>

          <option value="Instagram">
            Instagram
          </option>

          <option value="YouTube">
            YouTube
          </option>

          <option value="TikTok">
            TikTok
          </option>

          <option value="Другое">
            Другое
          </option>

        </select>

      </div>

      <div class="field">

        <label>
          Формат
        </label>

        <input
          data-field="format"
          type="text"
          placeholder="Пост / Reels / Видео"
          value="${esc(
            data?.format ||
            "Пост"
          )}"
        />

      </div>

      <div class="field">

        <label>
          Дата
        </label>

        <input
          data-field="date"
          type="date"
          value="${esc(
            data?.publication_date ||
            presetDate ||
            isoToday()
          )}"
        />

      </div>

      <div class="field">

        <label>
          Время
        </label>

        <input
          data-field="time"
          type="time"
          value="${esc(
            data?.publication_time
              ? data.publication_time.slice(
                  0,
                  5
                )
              : ""
          )}"
        />

      </div>

      <div class="field">

        <label>
          Статус
        </label>

        <select data-field="status">

          <option value="planned">
            Запланировано
          </option>

          <option value="progress">
            В работе
          </option>

          <option value="done">
            Готово
          </option>

        </select>

      </div>

      <div class="field">

        <label>
          Ссылка
        </label>

        <input
          data-field="link"
          type="url"
          placeholder="https://…"
          value="${esc(
            data?.link || ""
          )}"
        />

      </div>

      <div class="field full-field">

        <label>
          Описание публикации
        </label>

        <textarea
          data-field="description"
          rows="3"
          placeholder="Дополнительная информация"
        >${esc(
          data?.description || ""
        )}</textarea>

      </div>

      <div class="field full-field">

        <label>
          Ответственные
        </label>

        <div class="assignee-picker">

          <div
            class="assignee-selected"
            data-selected
          ></div>

          <input
            data-search
            type="search"
            placeholder="Поиск участника"
          />

          <div data-options></div>

        </div>

      </div>

      <div class="field full-field">

        <label>
          Напоминания
        </label>

        <div class="reminders">

          <label class="reminder-option">

            <input
              type="checkbox"
              data-reminder="24h"
              ${
                data
                  ? (
                      data.reminder_24h
                        ? "checked"
                        : ""
                    )
                  : "checked"
              }
            >

            за 24 часа

          </label>

          <label class="reminder-option">

            <input
              type="checkbox"
              data-reminder="3h"
              ${
                data?.reminder_3h
                  ? "checked"
                  : ""
              }
            >

            за 3 часа

          </label>

          <label class="reminder-option">

            <input
              type="checkbox"
              data-reminder="1h"
              ${
                data?.reminder_1h
                  ? "checked"
                  : ""
              }
            >

            за 1 час

          </label>

        </div>

      </div>

    </div>
  `;

  const platform =
    node.querySelector(
      '[data-field="platform"]'
    );

  const status =
    node.querySelector(
      '[data-field="status"]'
    );

  platform.value =
    data?.platform ||
    "Telegram";

  status.value =
    data?.status ||
    "planned";

  const renderPicker =
    () => {

      const search =
        (
          node.querySelector(
            "[data-search]"
          ).value || ""
        )
          .toLowerCase()
          .trim();

      const selectedBox =
        node.querySelector(
          "[data-selected]"
        );

      const optionsBox =
        node.querySelector(
          "[data-options]"
        );

      const chosen =
        [...selected]
          .map(
            id =>
              members.find(
                m =>
                  m.id === id
              )
          )
          .filter(Boolean);

      selectedBox.innerHTML =
        chosen.length
          ? chosen
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
              .join("")
          : `
            <span class="assignee-placeholder">
              Никто не выбран
            </span>
          `;

      const filtered =
        members.filter(
          member =>
            (
              member.telegram_first_name ||
              ""
            )
              .toLowerCase()
              .includes(search)
            ||
            (
              member.telegram_username ||
              ""
            )
              .toLowerCase()
              .includes(search)
        );

      optionsBox.innerHTML = `
        <div class="assignee-options">

          ${filtered
            .map(
              member => `
                <label class="assignee-option">

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

                  <span class="assignee-option-name">

                    ${esc(
                      member.telegram_first_name ||
                      "Без имени"
                    )}

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
            .join("")}

        </div>
      `;

      optionsBox
        .querySelectorAll(
          "[data-user]"
        )
        .forEach(
          checkbox => {

            checkbox.addEventListener(
              "change",
              () => {

                if (
                  checkbox.checked
                ) {
                  selected.add(
                    checkbox.dataset.user
                  );
                } else {
                  selected.delete(
                    checkbox.dataset.user
                  );
                }

                renderPicker();
              }
            );
          }
        );

      selectedBox
        .querySelectorAll(
          "[data-remove]"
        )
        .forEach(
          button => {

            button.addEventListener(
              "click",
              () => {

                selected.delete(
                  button.dataset.remove
                );

                renderPicker();
              }
            );
          }
        );
    };

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
    .addEventListener(
      "click",
      () => {

        if (
          document.querySelectorAll(
            "[data-publication]"
          ).length <= 1
        ) {
          toast(
            "Должна остаться хотя бы одна публикация"
          );

          return;
        }

        node.remove();

        renumberEditors();
      }
    );

  node._selected =
    selected;

  wrap.appendChild(
    node
  );

  renumberEditors();
}

function renumberEditors() {
  document
    .querySelectorAll(
      "[data-publication] .pub-number"
    )
    .forEach(
      (element, index) => {
        element.textContent =
          `Публикация ${index + 1}`;
      }
    );
}

/* =========================
   SAVE CONTENT
========================= */

async function saveContent(event) {
  event.preventDefault();

  if (
    saving ||
    !currentProject
  ) {
    return;
  }

  const title =
    $("contentTitle")
      .value
      .trim();

  if (!title) {

    toast(
      "Введите название контента"
    );

    $("contentTitle").focus();

    return;
  }

  const nodes =
    [
      ...document.querySelectorAll(
        "[data-publication]"
      )
    ];

  if (!nodes.length) {

    toast(
      "Добавьте хотя бы одну публикацию"
    );

    return;
  }

  for (const node of nodes) {

    const pubTitle =
      node
        .querySelector(
          '[data-field="title"]'
        )
        .value
        .trim();

    const pubDate =
      node
        .querySelector(
          '[data-field="date"]'
        )
        .value;

    if (
      !pubTitle ||
      !pubDate
    ) {

      toast(
        "Заполните название и дату публикации"
      );

      return;
    }
  }

  saving = true;

  const button =
    $("saveContentBtn");

  if (button) {
    button.disabled = true;
    button.textContent =
      "Сохраняем…";
  }

  try {

    const id =
      $("contentId")
        .value ||
      null;

    let saved;

    const payload = {
      title,
      description:
        $("contentDescription")
          .value
          .trim()
    };

    /*
      Создаём или обновляем основной контент.
    */

    if (id) {

      const result =
        await db
          .from("content")
          .update(payload)
          .eq("id", id)
          .select()
          .single();

      if (result.error) {
        throw result.error;
      }

      saved =
        result.data;

    } else {

      const result =
        await db
          .from("content")
          .insert({
            ...payload,
            project_id:
              currentProject.id,
            created_by:
              currentUser.id
          })
          .select()
          .single();

      if (result.error) {
        throw result.error;
      }

      saved =
        result.data;
    }

    const kept = [];

    /*
      Сохраняем каждую публикацию.
    */

    for (
      const node of nodes
    ) {

      const get =
        field =>
          node.querySelector(
            `[data-field="${field}"]`
          ).value;

      const pubPayload = {
        content_id:
          saved.id,

        project_id:
          currentProject.id,

        title:
          get("title").trim(),

        platform:
          get("platform"),

        format:
          get("format").trim() ||
          "Пост",

        publication_date:
          get("date"),

        publication_time:
          get("time") ||
          null,

        status:
          get("status"),

        link:
          get("link").trim() ||
          null,

        description:
          get("description").trim() ||
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

      const existingId =
        node.dataset.existingId;

      let result;

      if (existingId) {

        result =
          await db
            .from("publications")
            .update(
              pubPayload
            )
            .eq(
              "id",
              existingId
            )
            .select()
            .single();

      } else {

        result =
          await db
            .from("publications")
            .insert(
              pubPayload
            )
            .select()
            .single();
      }

      if (result.error) {
        throw result.error;
      }

      const pub =
        result.data;

      kept.push(
        pub.id
      );

      /*
        Перезаписываем ответственных.
      */

      const del =
        await db
          .from(
            "publication_assignees"
          )
          .delete()
          .eq(
            "publication_id",
            pub.id
          );

      if (del.error) {
        throw del.error;
      }

      const selected =
        [
          ...(node._selected ||
            new Set())
        ];

      if (selected.length) {

        const ins =
          await db
            .from(
              "publication_assignees"
            )
            .insert(
              selected.map(
                user_id => ({
                  publication_id:
                    pub.id,
                  user_id
                })
              )
            );

        if (ins.error) {
          throw ins.error;
        }
      }
    }

    /*
      Удаляем публикации,
      которые были удалены пользователем
      из редактора.
    */

    if (id) {

      const removed =
        publications
          .filter(
            p =>
              p.content_id ===
              id &&
              !kept.includes(
                p.id
              )
          )
          .map(
            p => p.id
          );

      if (removed.length) {

        const result =
          await db
            .from(
              "publications"
            )
            .delete()
            .in(
              "id",
              removed
            );

        if (result.error) {
          throw result.error;
        }
      }
    }

    closeModal();

    await loadContent();

    renderEverything();

    toast(
      "Сохранено"
    );

  } catch (error) {

    console.error(
      "Save content:",
      error
    );

    toast(
      error?.message ||
      "Ошибка сохранения"
    );

  } finally {

    /*
      Кнопка Сохранить
      всегда возвращается
      в рабочее состояние,
      даже если Supabase вернул ошибку.
    */

    saving = false;

    if (button) {
      button.disabled = false;
      button.textContent =
        "Сохранить";
    }
  }
}

/* =========================
   DELETE CONTENT
========================= */

async function deleteContent() {
  const id =
    $("contentId")
      .value;

  if (
    !id ||
    !confirm(
      "Удалить этот контент и все его публикации?"
    )
  ) {
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

  if (error) {

    console.error(
      error
    );

    toast(
      error.message ||
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

/* =========================
   EVENTS
========================= */

function bindEvents() {

  /*
    Календарь
  */

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
    Добавление контента
  */

  $("addContentTop")
    ?.addEventListener(
      "click",
      () =>
        openModal(
          null,
          isoToday()
        )
    );

  $("addContentBtn")
    ?.addEventListener(
      "click",
      () =>
        openModal()
    );

  /*
    Добавление публикации
  */

  $("addPublicationBtn")
    ?.addEventListener(
      "click",
      () =>
        addPublicationEditor()
    );

  /*
    Добавление публикации
    прямо из выбранного дня.
  */

  $("addPublicationForDay")
    ?.addEventListener(
      "click",
      () => {

        const date =
          selectedDayForNewPublication ||
          isoToday();

        closeDayDetails();

        openModal(
          null,
          date
        );
      }
    );

  /*
    Сохранение
  */

  $("contentForm")
    ?.addEventListener(
      "submit",
      saveContent
    );

  /*
    Удаление
  */

  $("deleteContentBtn")
    ?.addEventListener(
      "click",
      deleteContent
    );

  /*
    Закрытие модального окна.
  */

  $("closeModal")
    ?.addEventListener(
      "click",
      closeModal
    );

  $("closeDayModal")
    ?.addEventListener(
      "click",
      closeDayDetails
    );

  document
    .querySelectorAll(
      "[data-close-content-modal]"
    )
    .forEach(
      element =>
        element.addEventListener(
          "click",
          closeModal
        )
    );

  document
    .querySelectorAll(
      "[data-close-day-modal]"
    )
    .forEach(
      element =>
        element.addEventListener(
          "click",
          closeDayDetails
        )
    );

  /*
    Нижняя навигация.
  */

  document
    .querySelectorAll(
      ".nav-button"
    )
    .forEach(
      button =>
        button.addEventListener(
          "click",
          () =>
            switchView(
              button.dataset.view
            )
        )
    );

  /*
    Поиск контента.
  */

  $("contentSearch")
    ?.addEventListener(
      "input",
      renderContent
    );

  /*
    Фильтр площадки.
  */

  $("platformFilter")
    ?.addEventListener(
      "change",
      renderContent
    );

  /*
    Период аналитики.
  */

  $("analyticsPeriod")
    ?.addEventListener(
      "change",
      () => {

        activePeriod =
          $("analyticsPeriod")
            .value;

        renderAnalytics();
      }
    );

  /*
    Фильтр площадки аналитики.
  */

  $("analyticsPlatform")
    ?.addEventListener(
      "change",
      renderAnalytics
    );

  /*
    Escape закрывает модалки.
  */

  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key ===
        "Escape"
      ) {
        closeModal();
        closeDayDetails();
      }
    }
  );
}

/* =========================
   RUN
========================= */

boot();
