const SUPABASE_URL = "https://vkvrwayzqrlsfsgjjwpy.supabase.co";
const SUPABASE_KEY = "sb_publishable_-kj7hiC7uou3db2wpwFM_w_jgXQNpnb";

const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const tg = window.Telegram?.WebApp;

let currentUser = null;
let currentProject = null;

let members = [];
let contents = [];
let publications = [];
let publicationAssignees = [];

let currentMonth = new Date();
currentMonth.setDate(1);

let analyticsPeriod = "week";

let dayStyles = {};

let editingContentId = null;


/* =========================================================
   HELPERS
========================================================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toISO(date) {
  const d = new Date(date);

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${y}-${m}-${day}`;
}

function formatDate(dateString) {
  if (!dateString) return "";

  const date = new Date(`${dateString}T00:00:00`);

  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long"
  });
}

function formatShortDate(dateString) {
  if (!dateString) return "";

  const date = new Date(`${dateString}T00:00:00`);

  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit"
  });
}

function formatMonth(date) {
  return date.toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric"
  });
}

function initials(profile) {
  const first =
    profile?.first_name ||
    profile?.username ||
    "?";

  const last =
    profile?.last_name || "";

  return (
    `${first.charAt(0)}${last.charAt(0)}`
  ).toUpperCase();
}

function memberName(member) {
  if (!member) return "Участник";

  const fullName = [
    member.first_name,
    member.last_name
  ]
    .filter(Boolean)
    .join(" ");

  return (
    fullName ||
    member.username ||
    "Участник"
  );
}

function publicationPlatformClass(platform) {
  return String(platform || "")
    .replace(/[^a-zA-ZА-Яа-я0-9]/g, "");
}

function getPublicationsForDate(date) {
  return publications
    .filter(p => p.publication_date === date)
    .sort((a, b) =>
      String(a.publication_time || "")
        .localeCompare(String(b.publication_time || ""))
    );
}

function getContent(contentId) {
  return contents.find(
    c => c.id === contentId
  );
}

function getAssigneeIds(publicationId) {
  return publicationAssignees
    .filter(
      a => a.publication_id === publicationId
    )
    .map(a => a.user_id);
}

function getMember(userId) {
  return members.find(
    m => m.id === userId
  );
}


/* =========================================================
   TELEGRAM
========================================================= */

function setupTelegram() {
  try {
    tg?.ready();
    tg?.expand();

    if (tg?.setHeaderColor) {
      tg.setHeaderColor("#f7f7f5");
    }

    if (tg?.setBackgroundColor) {
      tg.setBackgroundColor("#f7f7f5");
    }
  } catch (error) {
    console.warn(
      "Telegram setup error:",
      error
    );
  }
}


/* =========================================================
   AUTH
========================================================= */

async function authenticate() {
  setupTelegram();

  const authScreen =
    document.getElementById("authScreen");

  const app =
    document.getElementById("app");

  try {

    const {
      data: sessionData,
      error: sessionError
    } = await supabase.auth.getSession();

    if (sessionError) {
      throw sessionError;
    }

    if (!sessionData.session) {

      const {
        data,
        error
      } =
        await supabase.auth.signInAnonymously();

      if (error) {
        throw error;
      }

      currentUser =
        data.user;

    } else {

      currentUser =
        sessionData.session.user;

    }


    const initData =
      tg?.initData || "";

    if (initData) {

      const {
        error
      } =
        await supabase.functions.invoke(
          "telegram-auth",
          {
            body: {
              initData
            }
          }
        );

      if (error) {
        console.warn(
          "Telegram auth warning:",
          error
        );
      }

    }


    await loadProject();

    await loadMembers();

    await loadData();

    await loadDayStyles();

    subscribeRealtime();

    startTeamRefresh();

    authScreen?.classList.add(
      "hidden"
    );

    app?.classList.remove(
      "hidden"
    );

    renderAll();

  } catch (error) {

    console.error(
      "Authentication error:",
      error
    );

    if (authScreen) {
      authScreen.innerHTML = `
        <div class="auth-card">
          <div class="logo-mark">!</div>
          <h1>Не удалось открыть планер</h1>
          <p>
            Попробуй закрыть и снова открыть
            приложение в Telegram.
          </p>
        </div>
      `;
    }

  }
}


/* =========================================================
   PROJECT
========================================================= */

async function loadProject() {

  const {
    data,
    error
  } =
    await supabase
      .from("project_members")
      .select(`
        project_id,
        projects (
          id,
          name
        )
      `)
      .eq(
        "user_id",
        currentUser.id
      )
      .limit(1);

  if (error) {
    throw error;
  }

  if (data?.length) {

    currentProject =
      data[0].projects;

    return;
  }


  const {
    data: projects,
    error: projectError
  } =
    await supabase
      .from("projects")
      .select("*")
      .order(
        "created_at",
        { ascending: true }
      )
      .limit(1);

  if (projectError) {
    throw projectError;
  }

  if (projects?.length) {

    currentProject =
      projects[0];

    try {

      await supabase
        .from("project_members")
        .insert({
          project_id:
            currentProject.id,
          user_id:
            currentUser.id
        });

    } catch (error) {

      console.warn(
        "Could not add current user:",
        error
      );

    }

    return;
  }

  throw new Error(
    "Проект не найден"
  );
}


/* =========================================================
   TEAM
========================================================= */

async function loadMembers() {

  const {
    data,
    error
  } =
    await supabase
      .from("profiles")
      .select(`
        id,
        first_name,
        last_name,
        username,
        telegram_id
      `)
      .not(
        "telegram_id",
        "is",
        null
      )
      .order(
        "first_name",
        { ascending: true }
      );

  if (error) {

    console.warn(
      "Could not load all profiles:",
      error
    );

    await loadProjectMembers();

    return;
  }

  members = data || [];
}


async function loadProjectMembers() {

  const {
    data,
    error
  } =
    await supabase
      .from("project_members")
      .select(`
        user_id,
        profiles (
          id,
          first_name,
          last_name,
          username,
          telegram_id
        )
      `)
      .eq(
        "project_id",
        currentProject.id
      );

  if (error) {
    throw error;
  }

  members =
    (data || [])
      .map(row => row.profiles)
      .filter(Boolean);
}


/* =========================================================
   CONTENT DATA
========================================================= */

async function loadData() {

  const [
    contentResult,
    publicationResult,
    assigneeResult
  ] =
    await Promise.all([

      supabase
        .from("content")
        .select("*")
        .eq(
          "project_id",
          currentProject.id
        )
        .order(
          "created_at",
          { ascending: false }
        ),

      supabase
        .from("publications")
        .select("*")
        .eq(
          "project_id",
          currentProject.id
        )
        .order(
          "publication_date",
          { ascending: true }
        )
        .order(
          "publication_time",
          { ascending: true }
        ),

      supabase
        .from("publication_assignees")
        .select(`
          publication_id,
          user_id
        `)
    ]);


  if (contentResult.error) {
    throw contentResult.error;
  }

  if (publicationResult.error) {
    throw publicationResult.error;
  }

  if (assigneeResult.error) {
    throw assigneeResult.error;
  }


  contents =
    contentResult.data || [];

  publications =
    publicationResult.data || [];

  publicationAssignees =
    assigneeResult.data || [];
}


/* =========================================================
   DAY COLORS
========================================================= */

async function loadDayStyles() {

  const {
    data,
    error
  } =
    await supabase
      .from("calendar_day_styles")
      .select(`
        date,
        color
      `)
      .eq(
        "project_id",
        currentProject.id
      );

  if (error) {

    console.warn(
      "Calendar colors are unavailable:",
      error
    );

    dayStyles = {};

    return;
  }

  dayStyles = {};

  (data || []).forEach(row => {
    dayStyles[row.date] =
      row.color;
  });
}


async function saveDayColor(
  date,
  color
) {

  if (!currentProject) return;


  if (!color) {

    const {
      error
    } =
      await supabase
        .from("calendar_day_styles")
        .delete()
        .eq(
          "project_id",
          currentProject.id
        )
        .eq(
          "date",
          date
        );

    if (error) {
      console.error(error);
      return;
    }

    delete dayStyles[date];

  } else {

    const {
      error
    } =
      await supabase
        .from("calendar_day_styles")
        .upsert(
          {
            project_id:
              currentProject.id,
            date,
            color
          },
          {
            onConflict:
              "project_id,date"
          }
        );

    if (error) {
      console.error(error);
      return;
    }

    dayStyles[date] = color;
  }


  renderCalendar();
}


/* =========================================================
   REALTIME
========================================================= */

function subscribeRealtime() {

  supabase
    .channel(
      "media-planner-content"
    )

    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "content",
        filter:
          `project_id=eq.${currentProject.id}`
      },
      async () => {

        await loadData();
        renderAll();

      }
    )

    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "publications",
        filter:
          `project_id=eq.${currentProject.id}`
      },
      async () => {

        await loadData();
        renderAll();

      }
    )

    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "publication_assignees"
      },
      async () => {

        await loadData();
        renderAll();

      }
    )

    .subscribe();
}


function startTeamRefresh() {

  setInterval(
    async () => {

      try {

        await loadMembers();

        renderTeam();

        renderAnalytics();

      } catch (error) {

        console.warn(
          "Team refresh:",
          error
        );

      }

    },
    15000
  );
}


/* =========================================================
   RENDER ALL
========================================================= */

function renderAll() {

  renderCalendar();

  renderUpcoming();

  renderContent();

  renderTeam();

  renderAnalytics();
}


/* =========================================================
   CALENDAR
========================================================= */

function renderCalendar() {

  const grid =
    document.getElementById(
      "calendarGrid"
    );

  const monthLabel =
    document.getElementById(
      "monthLabel"
    );

  if (!grid) return;


  monthLabel.textContent =
    formatMonth(currentMonth);


  const year =
    currentMonth.getFullYear();

  const month =
    currentMonth.getMonth();

  const firstDay =
    new Date(
      year,
      month,
      1
    );

  let start =
    firstDay.getDay();

  if (start === 0) {
    start = 7;
  }

  const daysInMonth =
    new Date(
      year,
      month + 1,
      0
    ).getDate();


  let html = "";


  for (
    let i = 1;
    i < start;
    i++
  ) {

    html += `
      <div class="calendar-day empty"></div>
    `;

  }


  const today =
    toISO(new Date());


  for (
    let day = 1;
    day <= daysInMonth;
    day++
  ) {

    const date =
      `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    const dayPubs =
      getPublicationsForDate(date);

    const color =
      dayStyles[date] || "";


    let chips = "";

    dayPubs
      .slice(0, 4)
      .forEach(pub => {

        const platformClass =
          publicationPlatformClass(
            pub.platform
          );

        chips += `
          <button
            type="button"
            class="publication-chip platform-${platformClass}"
            data-publication-id="${pub.id}"
          >
            <span>
              ${escapeHtml(pub.platform)}
            </span>

            <strong>
              ${escapeHtml(pub.title)}
            </strong>
          </button>
        `;

      });


    if (dayPubs.length > 4) {

      chips += `
        <div class="more-chip">
          +${dayPubs.length - 4}
        </div>
      `;

    }


    html += `
      <div
        class="calendar-day ${color ? `day-color-${color}` : ""} ${date === today ? "today" : ""}"
        data-date="${date}"
      >

        <button
          type="button"
          class="day-number"
          data-day-date="${date}"
        >
          ${day}
        </button>

        <button
          type="button"
          class="day-palette-trigger"
          data-palette-date="${date}"
          aria-label="Цвет дня"
        >
          •••
        </button>

        <div class="publication-chips">
          ${chips}
        </div>

      </div>
    `;

  }


  grid.innerHTML =
    html;


  grid
    .querySelectorAll(
      ".calendar-day:not(.empty)"
    )
    .forEach(cell => {

      cell.addEventListener(
        "click",
        event => {

          if (
            event.target.closest(
              ".publication-chip"
            )
          ) {
            return;
          }

          if (
            event.target.closest(
              ".day-palette-trigger"
            )
          ) {
            return;
          }

          const date =
            cell.dataset.date;

          openDayEditor(date);

        }
      );

    });


  grid
    .querySelectorAll(
      ".publication-chip"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        event => {

          event.stopPropagation();

          openPublication(
            button.dataset.publicationId
          );

        }
      );

    });


  grid
    .querySelectorAll(
      ".day-palette-trigger"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        event => {

          event.stopPropagation();

          showDayPalette(
            button.dataset.paletteDate,
            button
          );

        }
      );

    });

}


function openDayEditor(date) {

  const dayPubs =
    getPublicationsForDate(date);

  if (dayPubs.length) {

    const first =
      dayPubs[0];

    openModal(
      first.content_id,
      date
    );

    return;
  }


  openModal(
    null,
    date
  );

}


function showDayPalette(
  date,
  anchor
) {

  document
    .querySelectorAll(
      ".day-palette"
    )
    .forEach(el => el.remove());


  const palette =
    document.createElement("div");

  palette.className =
    "day-palette";


  palette.innerHTML = `

    <button
      class="palette-white"
      data-color=""
      aria-label="Белый"
    ></button>

    <button
      class="palette-yellow"
      data-color="yellow"
      aria-label="Жёлтый"
    ></button>

    <button
      class="palette-purple"
      data-color="purple"
      aria-label="Фиолетовый"
    ></button>

    <button
      class="palette-green"
      data-color="green"
      aria-label="Зелёный"
    ></button>

  `;


  anchor.parentElement.appendChild(
    palette
  );


  palette
    .querySelectorAll("button")
    .forEach(button => {

      button.addEventListener(
        "click",
        async event => {

          event.stopPropagation();

          await saveDayColor(
            date,
            button.dataset.color
          );

          palette.remove();

        }
      );

    });


  setTimeout(() => {

    document.addEventListener(
      "click",
      function closePalette(event) {

        if (
          !palette.contains(event.target) &&
          event.target !== anchor
        ) {

          palette.remove();

          document.removeEventListener(
            "click",
            closePalette
          );

        }

      }
    );

  }, 0);
}


/* =========================================================
   UPCOMING
========================================================= */

function renderUpcoming() {

  const container =
    document.getElementById(
      "upcomingList"
    );

  if (!container) return;


  const today =
    toISO(new Date());


  const items =
    publications
      .filter(
        p =>
          p.publication_date >= today &&
          p.status !== "done"
      )
      .sort((a, b) => {

        const aKey =
          `${a.publication_date} ${a.publication_time || ""}`;

        const bKey =
          `${b.publication_date} ${b.publication_time || ""}`;

        return aKey.localeCompare(
          bKey
        );

      })
      .slice(0, 8);


  if (!items.length) {

    container.innerHTML = `
      <div class="empty-state">
        Пока нет ближайших публикаций
      </div>
    `;

    return;
  }


  container.innerHTML =
    items
      .map(pub => {

        return `
          <button
            type="button"
            class="upcoming-card"
            data-publication-id="${pub.id}"
          >

            <div class="upcoming-date">

              <strong>
                ${new Date(
                  `${pub.publication_date}T00:00:00`
                ).getDate()}
              </strong>

              <span>
                ${new Date(
                  `${pub.publication_date}T00:00:00`
                ).toLocaleDateString(
                  "ru-RU",
                  { month: "short" }
                )}
              </span>

            </div>


            <div class="upcoming-main">

              <div class="upcoming-title">
                ${escapeHtml(pub.title)}
              </div>

              <div class="upcoming-meta">
                ${escapeHtml(pub.platform)}
                ·
                ${escapeHtml(pub.format)}
                ${pub.publication_time ? ` · ${pub.publication_time}` : ""}
              </div>

            </div>

            <div class="upcoming-arrow">
              ›
            </div>

          </button>
        `;

      })
      .join("");


  container
    .querySelectorAll(
      "[data-publication-id]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          openPublication(
            button.dataset.publicationId
          );

        }
      );

    });

}


/* =========================================================
   CONTENT LIST
========================================================= */

function renderContent() {

  const container =
    document.getElementById(
      "contentList"
    );

  if (!container) return;


  if (!contents.length) {

    container.innerHTML = `
      <div class="empty-state">
        Контента пока нет.
        Нажми «+ Контент», чтобы создать первый.
      </div>
    `;

    return;
  }


  container.innerHTML =
    contents
      .map(content => {

        const pubs =
          publications
            .filter(
              p =>
                p.content_id === content.id
            )
            .sort((a, b) => {

              const aKey =
                `${a.publication_date} ${a.publication_time || ""}`;

              const bKey =
                `${b.publication_date} ${b.publication_time || ""}`;

              return aKey.localeCompare(
                bKey
              );

            });


        return `
          <article
            class="content-card"
            data-content-id="${content.id}"
          >

            <div class="content-card-head">

              <div>

                <h3>
                  ${escapeHtml(content.title)}
                </h3>

                ${
                  content.description
                    ? `
                      <p class="content-card-description">
                        ${escapeHtml(
                          content.description
                        )}
                      </p>
                    `
                    : ""
                }

              </div>

              <button
                type="button"
                class="secondary-btn edit-content-btn"
              >
                Изменить
              </button>

            </div>


            <div class="content-publications">

              ${
                pubs.length
                  ? pubs.map(pub => {

                      return `
                        <button
                          type="button"
                          class="content-publication-row"
                          data-publication-id="${pub.id}"
                        >

                          <span class="pub-meta">
                            ${formatShortDate(
                              pub.publication_date
                            )}
                          </span>

                          <span class="pub-meta">
                            ${escapeHtml(
                              pub.platform
                            )}
                          </span>

                          <span class="pub-title">
                            ${escapeHtml(
                              pub.title
                            )}
                          </span>

                          <span class="pub-meta">
                            ${escapeHtml(
                              pub.format
                            )}
                          </span>

                        </button>
                      `;

                    }).join("")
                  : `
                    <div class="empty-state">
                      Нет публикаций
                    </div>
                  `
              }

            </div>

          </article>
        `;

      })
      .join("");


  container
    .querySelectorAll(
      ".edit-content-btn"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        event => {

          event.stopPropagation();

          const card =
            button.closest(
              "[data-content-id]"
            );

          openModal(
            card.dataset.contentId
          );

        }
      );

    });


  container
    .querySelectorAll(
      "[data-publication-id]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          openPublication(
            button.dataset.publicationId
          );

        }
      );

    });

}


/* =========================================================
   TEAM
========================================================= */

function renderTeam() {

  const container =
    document.getElementById(
      "teamList"
    );

  const count =
    document.getElementById(
      "teamCount"
    );

  if (!container) return;


  if (count) {

    count.textContent =
      `${members.length} ${
        members.length === 1
          ? "участник"
          : "участников"
      }`;

  }


  if (!members.length) {

    container.innerHTML = `
      <div class="empty-state">
        Пока никто не подключился
      </div>
    `;

    return;
  }


  container.innerHTML =
    members
      .map(member => {

        return `
          <article class="team-card">

            <div class="avatar">
              ${escapeHtml(
                initials(member)
              )}
            </div>

            <div>

              <div class="team-name">
                ${escapeHtml(
                  memberName(member)
                )}
              </div>

              ${
                member.username
                  ? `
                    <div class="team-username">
                      @${escapeHtml(
                        member.username
                      )}
                    </div>
                  `
                  : ""
              }

            </div>

          </article>
        `;

      })
      .join("");

}


/* =========================================================
   ANALYTICS
========================================================= */

function renderAnalytics() {

  const filtered =
    getAnalyticsPublications();


  const total =
    filtered.length;


  const totalElement =
    document.getElementById(
      "statTotal"
    );

  const weekElement =
    document.getElementById(
      "statWeek"
    );


  if (totalElement) {
    totalElement.textContent =
      total;
  }


  if (weekElement) {

    const days =
      analyticsPeriod === "week"
        ? 7
        : analyticsPeriod === "month"
          ? 30
          : analyticsPeriod === "3months"
            ? 90
            : 365;


    const average =
      days
        ? total / (days / 7)
        : 0;


    weekElement.textContent =
      average.toFixed(1);

  }


  renderStatList(
    "platformStats",
    countBy(
      filtered,
      "platform"
    )
  );


  renderStatList(
    "formatStats",
    countBy(
      filtered,
      "format"
    )
  );


  const weekdayMap = {
    "Пн": 0,
    "Вт": 0,
    "Ср": 0,
    "Чт": 0,
    "Пт": 0,
    "Сб": 0,
    "Вс": 0
  };


  filtered.forEach(pub => {

    const date =
      new Date(
        `${pub.publication_date}T00:00:00`
      );

    let day =
      date.getDay();

    day =
      day === 0
        ? 6
        : day - 1;

    const names =
      [
        "Пн",
        "Вт",
        "Ср",
        "Чт",
        "Пт",
        "Сб",
        "Вс"
      ];

    weekdayMap[names[day]]++;

  });


  renderStatList(
    "weekdayStats",
    weekdayMap
  );


  const assigneeMap = {};


  filtered.forEach(pub => {

    getAssigneeIds(
      pub.id
    ).forEach(userId => {

      const member =
        getMember(userId);

      if (!member) return;

      const name =
        memberName(member);

      assigneeMap[name] =
        (assigneeMap[name] || 0) + 1;

    });

  });


  renderStatList(
    "assigneeStats",
    assigneeMap
  );

}


function getAnalyticsPublications() {

  if (
    analyticsPeriod === "all"
  ) {
    return [...publications];
  }


  const now =
    new Date();

  const days =
    analyticsPeriod === "week"
      ? 7
      : analyticsPeriod === "month"
        ? 30
        : 90;


  const from =
    new Date(now);

  from.setDate(
    from.getDate() - days
  );


  return publications.filter(
    pub => {

      const date =
        new Date(
          `${pub.publication_date}T00:00:00`
        );

      return date >= from;

    }
  );
}


function countBy(
  rows,
  key
) {

  const result = {};

  rows.forEach(row => {

    const value =
      row[key] || "Не указано";

    result[value] =
      (result[value] || 0) + 1;

  });

  return result;
}


function renderStatList(
  elementId,
  values
) {

  const container =
    document.getElementById(
      elementId
    );

  if (!container) return;


  const entries =
    Object.entries(values)
      .sort(
        (a, b) =>
          b[1] - a[1]
      );


  if (!entries.length) {

    container.innerHTML = `
      <div class="empty-state">
        Нет данных
      </div>
    `;

    return;
  }


  const max =
    Math.max(
      ...entries.map(
        item => item[1]
      )
    );


  container.innerHTML =
    entries
      .map(
        ([name, value]) => {

          const width =
            max
              ? (value / max) * 100
              : 0;

          return `
            <div class="stat-row">

              <div class="stat-row-top">

                <span>
                  ${escapeHtml(name)}
                </span>

                <strong>
                  ${value}
                </strong>

              </div>

              <div class="stat-bar">

                <div
                  class="stat-bar-fill"
                  style="width:${width}%"
                ></div>

              </div>

            </div>
          `;

        }
      )
      .join("");

}


/* =========================================================
   MODAL
========================================================= */

function openModal(
  contentId = null,
  presetDate = null
) {

  editingContentId =
    contentId;


  const modal =
    document.getElementById(
      "modal"
    );

  const title =
    document.getElementById(
      "modalTitle"
    );

  const contentTitle =
    document.getElementById(
      "contentTitle"
    );

  const contentDescription =
    document.getElementById(
      "contentDescription"
    );

  const contentIdInput =
    document.getElementById(
      "editingContentId"
    );

  const editorList =
    document.getElementById(
      "publicationEditorList"
    );

  const deleteButton =
    document.getElementById(
      "deleteContentBtn"
    );


  editorList.innerHTML =
    "";


  if (contentId) {

    const content =
      getContent(contentId);

    if (!content) return;


    title.textContent =
      "Редактировать контент";


    contentTitle.value =
      content.title || "";


    contentDescription.value =
      content.description || "";


    contentIdInput.value =
      content.id;


    deleteButton.classList.remove(
      "hidden"
    );


    const pubs =
      publications.filter(
        p =>
          p.content_id === content.id
      );


    if (pubs.length) {

      pubs.forEach(pub => {

        addPublicationEditor(
          pub
        );

      });

    } else {

      addPublicationEditor(
        null,
        presetDate
      );

    }

  } else {

    title.textContent =
      "Новый контент";


    contentTitle.value =
      "";


    contentDescription.value =
      "";


    contentIdInput.value =
      "";


    deleteButton.classList.add(
      "hidden"
    );


    addPublicationEditor(
      null,
      presetDate
    );

  }


  modal.classList.remove(
    "hidden"
  );

  document.body.style.overflow =
    "hidden";
}


function closeModal() {

  const modal =
    document.getElementById(
      "modal"
    );

  modal?.classList.add(
    "hidden"
  );

  document.body.style.overflow =
    "";

  editingContentId =
    null;
}


function openPublication(
  publicationId
) {

  const publication =
    publications.find(
      p => p.id === publicationId
    );

  if (!publication) return;

  openModal(
    publication.content_id,
    publication.publication_date
  );
}


/* =========================================================
   PUBLICATION EDITOR
========================================================= */

function addPublicationEditor(
  data = null,
  presetDate = null
) {

  const template =
    document.getElementById(
      "publicationTemplate"
    );

  const list =
    document.getElementById(
      "publicationEditorList"
    );


  const node =
    template.content
      .firstElementChild
      .cloneNode(true);


  const publicationId =
    data?.id || "";


  node.dataset.id =
    publicationId;


  node.querySelector(
    '[data-field="title"]'
  ).value =
    data?.title || "";


  node.querySelector(
    '[data-field="platform"]'
  ).value =
    data?.platform || "Telegram";


  node.querySelector(
    '[data-field="format"]'
  ).value =
    data?.format || "Пост";


  node.querySelector(
    '[data-field="date"]'
  ).value =
    data?.publication_date ||
    presetDate ||
    toISO(new Date());


  node.querySelector(
    '[data-field="time"]'
  ).value =
    data?.publication_time || "";


  node.querySelector(
    '[data-field="status"]'
  ).value =
    data?.status || "planned";


  node.querySelector(
    '[data-field="link"]'
  ).value =
    data?.link || "";


  node.querySelector(
    '[data-field="description"]'
  ).value =
    data?.description || "";


  node.querySelector(
    '[data-reminder="24h"]'
  ).checked =
    data?.reminder_24h ?? true;


  node.querySelector(
    '[data-reminder="3h"]'
  ).checked =
    data?.reminder_3h ?? false;


  node.querySelector(
    '[data-reminder="1h"]'
  ).checked =
    data?.reminder_1h ?? false;


  renderAssigneePicker(
    node,
    data?.id
      ? getAssigneeIds(data.id)
      : []
  );


  node.querySelector(
    ".remove-publication"
  ).addEventListener(
    "click",
    () => {

      node.remove();

      updatePublicationNumbers();

    }
  );


  list.appendChild(
    node
  );


  const search =
    node.querySelector(
      "[data-search]"
    );


  search.addEventListener(
    "input",
    () => {

      renderAssigneePicker(
        node,
        getSelectedAssignees(node)
      );

    }
  );


  updatePublicationNumbers();
}


function updatePublicationNumbers() {

  document
    .querySelectorAll(
      "#publicationEditorList [data-publication]"
    )
    .forEach(
      (node, index) => {

        node.querySelector(
          ".pub-number"
        ).textContent =
          `Публикация ${index + 1}`;

      }
    );

}


/* =========================================================
   ASSIGNEES
========================================================= */

function renderAssigneePicker(
  node,
  selectedIds
) {

  const selectedContainer =
    node.querySelector(
      "[data-selected]"
    );

  const optionsContainer =
    node.querySelector(
      "[data-options]"
    );

  const searchInput =
    node.querySelector(
      "[data-search]"
    );


  const search =
    (
      searchInput?.value ||
      ""
    )
      .trim()
      .toLowerCase();


  const selected =
    new Set(
      selectedIds || []
    );


  selectedContainer.innerHTML =
    [...selected]
      .map(userId => {

        const member =
          getMember(userId);

        if (!member) return "";

        return `
          <span class="assignee-tag">

            ${escapeHtml(
              memberName(member)
            )}

            <button
              type="button"
              data-remove-assignee="${userId}"
            >
              ×
            </button>

          </span>
        `;

      })
      .join("");


  const filtered =
    members.filter(
      member => {

        const name =
          memberName(member)
            .toLowerCase();

        const username =
          String(
            member.username || ""
          )
            .toLowerCase();

        return (
          !search ||
          name.includes(search) ||
          username.includes(search)
        );

      }
    );


  optionsContainer.innerHTML =
    filtered
      .map(member => {

        const checked =
          selected.has(
            member.id
          );


        return `
          <label class="assignee-option">

            <input
              type="checkbox"
              data-assignee-id="${member.id}"
              ${checked ? "checked" : ""}
            >

            <span>
              ${escapeHtml(
                memberName(member)
              )}
            </span>

          </label>
        `;

      })
      .join("");


  selectedContainer
    .querySelectorAll(
      "[data-remove-assignee]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const id =
            button.dataset
              .removeAssignee;


          const current =
            getSelectedAssignees(node)
              .filter(
                userId =>
                  userId !== id
              );


          renderAssigneePicker(
            node,
            current
          );

        }
      );

    });


  optionsContainer
    .querySelectorAll(
      "[data-assignee-id]"
    )
    .forEach(input => {

      input.addEventListener(
        "change",
        () => {

          const current =
            getSelectedAssignees(node);


          const id =
            input.dataset
              .assigneeId;


          if (input.checked) {

            if (
              !current.includes(id)
            ) {
              current.push(id);
            }

          } else {

            const index =
              current.indexOf(id);

            if (index >= 0) {
              current.splice(
                index,
                1
              );
            }

          }


          renderAssigneePicker(
            node,
            current
          );

        }
      );

    });

}


function getSelectedAssignees(
  node
) {

  return [
    ...node.querySelectorAll(
      "[data-assignee-id]:checked"
    )
  ]
    .map(
      input =>
        input.dataset.assigneeId
    );

}


/* =========================================================
   SAVE CONTENT
========================================================= */

async function saveContent(
  event
) {

  event.preventDefault();


  if (!currentProject) {
    return;
  }


  const title =
    document
      .getElementById(
        "contentTitle"
      )
      .value
      .trim();


  const description =
    document
      .getElementById(
        "contentDescription"
      )
      .value
      .trim();


  if (!title) {

    alert(
      "Введите название контента"
    );

    return;
  }


  const publicationNodes =
    [
      ...document.querySelectorAll(
        "#publicationEditorList [data-publication]"
      )
    ];


  if (!publicationNodes.length) {

    alert(
      "Добавь хотя бы одну публикацию"
    );

    return;
  }


  const contentPayload = {

    project_id:
      currentProject.id,

    title,

    description:
      description || null,

    created_by:
      currentUser.id

  };


  let contentId =
    editingContentId;


  if (contentId) {

    const {
      error
    } =
      await supabase
        .from("content")
        .update({
          title,
          description:
            description || null
        })
        .eq(
          "id",
          contentId
        )
        .eq(
          "project_id",
          currentProject.id
        );

    if (error) {
      throw error;
    }

  } else {

    const {
      data,
      error
    } =
      await supabase
        .from("content")
        .insert(
          contentPayload
        )
        .select()
        .single();

    if (error) {
      throw error;
    }

    contentId =
      data.id;

  }


  const oldPublications =
    publications.filter(
      p =>
        p.content_id === contentId
    );


  const keptIds =
    [];


  for (
    const node of publicationNodes
  ) {

    const id =
      node.dataset.id || null;


    const publicationPayload = {

      content_id:
        contentId,

      project_id:
        currentProject.id,

      title:
        node.querySelector(
          '[data-field="title"]'
        ).value.trim(),

      platform:
        node.querySelector(
          '[data-field="platform"]'
        ).value,

      format:
        node.querySelector(
          '[data-field="format"]'
        ).value,

      publication_date:
        node.querySelector(
          '[data-field="date"]'
        ).value,

      publication_time:
        node.querySelector(
          '[data-field="time"]'
        ).value || null,

      status:
        node.querySelector(
          '[data-field="status"]'
        ).value,

      link:
        node.querySelector(
          '[data-field="link"]'
        ).value.trim() || null,

      description:
        node.querySelector(
          '[data-field="description"]'
        ).value.trim() || null,

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


    if (!publicationPayload.title) {

      alert(
        "У каждой публикации должно быть название"
      );

      return;

    }


    let savedPublication;


    if (id) {

      const {
        data,
        error
      } =
        await supabase
          .from("publications")
          .update(
            publicationPayload
          )
          .eq(
            "id",
            id
          )
          .select()
          .single();

      if (error) {
        throw error;
      }

      savedPublication =
        data;

      keptIds.push(id);

    } else {

      const {
        data,
        error
      } =
        await supabase
          .from("publications")
          .insert(
            publicationPayload
          )
          .select()
          .single();

      if (error) {
        throw error;
      }

      savedPublication =
        data;

      keptIds.push(
        savedPublication.id
      );

    }


    const selectedAssignees =
      getSelectedAssignees(
        node
      );


    await supabase
      .from(
        "publication_assignees"
      )
      .delete()
      .eq(
        "publication_id",
        savedPublication.id
      );


    if (
      selectedAssignees.length
    ) {

      const rows =
        selectedAssignees.map(
          userId => ({
            publication_id:
              savedPublication.id,
            user_id:
              userId
          })
        );


      const {
        error
      } =
        await supabase
          .from(
            "publication_assignees"
          )
          .insert(rows);

      if (error) {
        throw error;
      }

    }

  }


  const deletedIds =
    oldPublications
      .map(p => p.id)
      .filter(
        id =>
          !keptIds.includes(id)
      );


  if (deletedIds.length) {

    const {
      error
    } =
      await supabase
        .from("publications")
        .delete()
        .in(
          "id",
          deletedIds
        );

    if (error) {
      throw error;
    }

  }


  await loadData();

  closeModal();

  renderAll();

}


/* =========================================================
   DELETE CONTENT
========================================================= */

async function deleteContent() {

  if (!editingContentId) {
    return;
  }


  const confirmed =
    confirm(
      "Удалить этот контент вместе со всеми публикациями?"
    );


  if (!confirmed) {
    return;
  }


  const {
    error
  } =
    await supabase
      .from("content")
      .delete()
      .eq(
        "id",
        editingContentId
      )
      .eq(
        "project_id",
        currentProject.id
      );


  if (error) {
    alert(
      "Не удалось удалить контент"
    );

    console.error(error);

    return;
  }


  await loadData();

  closeModal();

  renderAll();

}


/* =========================================================
   NAVIGATION
========================================================= */

function switchView(
  viewId
) {

  document
    .querySelectorAll(
      ".view"
    )
    .forEach(view => {

      view.classList.toggle(
        "active",
        view.id === viewId
      );

    });


  document
    .querySelectorAll(
      ".nav-item"
    )
    .forEach(button => {

      button.classList.toggle(
        "active",
        button.dataset.view === viewId
      );

    });


  if (
    viewId === "analyticsView"
  ) {
    renderAnalytics();
  }

}


/* =========================================================
   EVENTS
========================================================= */

function setupEvents() {

  document
    .querySelectorAll(
      ".nav-item"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          switchView(
            button.dataset.view
          );

        }
      );

    });


  document
    .getElementById(
      "prevMonth"
    )
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


  document
    .getElementById(
      "nextMonth"
    )
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


  document
    .getElementById(
      "todayBtn"
    )
    ?.addEventListener(
      "click",
      () => {

        currentMonth =
          new Date();

        currentMonth.setDate(
          1
        );

        renderCalendar();

      }
    );


  document
    .getElementById(
      "addContentInline"
    )
    ?.addEventListener(
      "click",
      () => {

        openModal();

      }
    );


  document
    .getElementById(
      "showAllContent"
    )
    ?.addEventListener(
      "click",
      () => {

        switchView(
          "contentView"
        );

      }
    );


  document
    .getElementById(
      "addPublication"
    )
    ?.addEventListener(
      "click",
      () => {

        addPublicationEditor();

      }
    );


  document
    .getElementById(
      "contentForm"
    )
    ?.addEventListener(
      "submit",
      async event => {

        try {

          await saveContent(
            event
          );

        } catch (error) {

          console.error(error);

          alert(
            "Не удалось сохранить. Проверь подключение к базе."
          );

        }

      }
    );


  document
    .getElementById(
      "deleteContentBtn"
    )
    ?.addEventListener(
      "click",
      async () => {

        await deleteContent();

      }
    );


  document
    .querySelectorAll(
      "[data-close-modal]"
    )
    .forEach(element => {

      element.addEventListener(
        "click",
        closeModal
      );

    });


  document
    .querySelectorAll(
      ".filter-btn"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          analyticsPeriod =
            button.dataset.period;


          document
            .querySelectorAll(
              ".filter-btn"
            )
            .forEach(
              btn =>
                btn.classList.toggle(
                  "active",
                  btn === button
                )
            );


          renderAnalytics();

        }
      );

    });

}


/* =========================================================
   START
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    setupEvents();

    authenticate();

  }
);
