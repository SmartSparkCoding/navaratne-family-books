import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase,
  onValue,
  push,
  ref,
  remove,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const appConfig = window.APP_CONFIG ?? {};
const firebaseConfig = appConfig.firebase ?? {};
const expectedPasscode = String(appConfig.passcode ?? "0000");

const readerNames = ["Sarah", "Leroy", "Jacob", "Ollie", "Grannie"];
const defaultBookcases = [
  { id: "sunroom", name: "Sunroom Shelf", order: 1, accent: "#f2bac3", note: "light reads and favourites" },
  { id: "story-harbour", name: "Story Harbour", order: 2, accent: "#79b6af", note: "adventures and series" },
  { id: "dream-loft", name: "Dream Loft", order: 3, accent: "#c7c0f0", note: "quiet books and classics" },
  { id: "cozy-corner", name: "Cozy Corner", order: 4, accent: "#f6d39a", note: "family picks and keepsakes" },
];

const state = {
  unlocked: false,
  passcodeBuffer: "",
  view: "dashboard",
  search: "",
  bookcaseFilter: "all",
  readerFilter: "all",
  books: [],
  bookcases: [],
  firebaseReady: false,
  modalBookId: null,
};

const elements = {
  loginOverlay: document.getElementById("loginOverlay"),
  loginStatus: document.getElementById("loginStatus"),
  keypad: document.getElementById("keypad"),
  dots: [0, 1, 2, 3].map((index) => document.getElementById(`dot${index}`)),
  navButtons: [...document.querySelectorAll(".nav-btn")],
  searchInput: document.getElementById("searchInput"),
  openAddBookTop: document.getElementById("openAddBookTop"),
  dashboardView: document.getElementById("dashboardView"),
  booksView: document.getElementById("booksView"),
  addView: document.getElementById("addView"),
  statsView: document.getElementById("statsView"),
  summaryCards: document.getElementById("summaryCards"),
  bookcaseGrid: document.getElementById("bookcaseGrid"),
  booksGrid: document.getElementById("booksGrid"),
  booksCountLabel: document.getElementById("booksCountLabel"),
  bookcaseFilter: document.getElementById("bookcaseFilter"),
  readerFilter: document.getElementById("readerFilter"),
  clearFilters: document.getElementById("clearFilters"),
  statsGrid: document.getElementById("statsGrid"),
  personStats: document.getElementById("personStats"),
  bookModal: document.getElementById("bookModal"),
  bookDetailSummary: document.getElementById("bookDetailSummary"),
  editFormMount: document.getElementById("editFormMount"),
  addFormMount: document.getElementById("addFormMount"),
  toastStack: document.getElementById("toastStack"),
  bookFormTemplate: document.getElementById("bookFormTemplate"),
};

const palette = ["#f2bac3", "#f6d39a", "#79b6af", "#c7c0f0", "#f0b79b", "#a8d8c7", "#e7d2f5", "#b6d7f5"];

let database = null;
let booksRef = null;
let bookcasesRef = null;
let addForm = null;
let editForm = null;

function initFirebase() {
  try {
    if (!firebaseConfig.apiKey || !firebaseConfig.databaseURL || !firebaseConfig.projectId) {
      throw new Error("Missing Firebase configuration.");
    }

    const app = initializeApp(firebaseConfig);
    database = getDatabase(app);
    booksRef = ref(database, "books");
    bookcasesRef = ref(database, "bookcases");
    state.firebaseReady = true;

    onValue(booksRef, (snapshot) => {
      state.books = snapshotToArray(snapshot.val());
      refreshAll();
    });

    onValue(bookcasesRef, (snapshot) => {
      const loaded = snapshotToArray(snapshot.val()).map((bookcase) => ({
        ...bookcase,
        order: Number(bookcase.order ?? 0),
      }));
      state.bookcases = loaded.length ? loaded.sort((a, b) => a.order - b.order) : defaultBookcases;
      syncAllBookcaseSelects();
      refreshAll();
    });
  } catch (error) {
    state.firebaseReady = false;
    showToast("Firebase is not ready yet. Check the config values.");
    elements.loginStatus.textContent = error.message;
    console.error(error);
  }
}

function snapshotToArray(value) {
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).map(([id, entry]) => ({ id, ...entry }));
}

function getBookcases() {
  return [...state.bookcases].sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
}

function getBookcaseLabel(bookcaseId) {
  const bookcase = getBookcases().find((item) => item.id === bookcaseId);
  return bookcase?.name ?? "Unsorted";
}

function normalizeReaders(readers) {
  if (!readers) {
    return [];
  }

  if (Array.isArray(readers)) {
    return readers.filter(Boolean);
  }

  if (typeof readers === "object") {
    return Object.values(readers).filter(Boolean);
  }

  return [];
}

function getFilteredBooks() {
  const query = state.search.trim().toLowerCase();

  return [...state.books]
    .filter((book) => {
      if (state.bookcaseFilter !== "all" && book.bookcaseId !== state.bookcaseFilter) {
        return false;
      }

      if (state.readerFilter !== "all" && !normalizeReaders(book.readers).includes(state.readerFilter)) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = [
        book.name,
        book.author,
        book.series,
        book.genre,
        book.notes,
        book.isbn,
        getBookcaseLabel(book.bookcaseId),
        ...normalizeReaders(book.readers),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function getReaderCounts() {
  return readerNames.map((reader) => ({
    reader,
    count: state.books.filter((book) => normalizeReaders(book.readers).includes(reader)).length,
  }));
}

function getBookcaseCounts() {
  return getBookcases().map((bookcase) => ({
    ...bookcase,
    count: state.books.filter((book) => book.bookcaseId === bookcase.id).length,
  }));
}

function getSummaryStats() {
  const totalBooks = state.books.length;
  const booksWithReaders = state.books.filter((book) => normalizeReaders(book.readers).length > 0).length;
  const totalReadingChecks = state.books.reduce((sum, book) => sum + normalizeReaders(book.readers).length, 0);
  const totalBookcases = getBookcases().length;

  return [
    { label: "Books", value: totalBooks, note: "titles in the catalogue" },
    { label: "Read books", value: booksWithReaders, note: "books with at least one reader" },
    { label: "Read checkmarks", value: totalReadingChecks, note: "all selected reader counts" },
    { label: "Bookcases", value: totalBookcases, note: "shelves on the wall" },
  ];
}

function hashString(input) {
  return input.split("").reduce((total, char) => ((total << 5) - total + char.charCodeAt(0)) | 0, 0);
}

function pickColor(input) {
  const index = Math.abs(hashString(input)) % palette.length;
  return palette[index];
}

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

function createCoverMarkup(book) {
  if (book.coverImage) {
    return `<img src="${safeText(book.coverImage)}" alt="Cover for ${safeText(book.name)}" loading="lazy" />`;
  }

  return `<div class="fallback-cover">${safeText((book.name || "").slice(0, 2).toUpperCase() || "NB")}</div>`;
}

function bookDetails(book) {
  return [
    ["Series", book.series || "Not set"],
    ["Purchased", book.datePurchased || "Not set"],
    ["Read", book.dateRead || "Not set"],
    ["Bookcase", getBookcaseLabel(book.bookcaseId)],
    ["Genre", book.genre || "Not set"],
    ["ISBN", book.isbn || "Not set"],
  ];
}

function refreshAll() {
  if (!state.unlocked) {
    return;
  }

  updateNavState();
  renderView();
  renderSummaryCards();
  renderBookcases();
  renderBooks();
  renderStats();
}

function updateNavState() {
  elements.navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });

  [elements.dashboardView, elements.booksView, elements.addView, elements.statsView].forEach((section) => {
    section.classList.toggle("active", section.id.startsWith(state.view));
  });
}

function renderView() {
  updateNavState();
}

function renderSummaryCards() {
  const summary = getSummaryStats();
  elements.summaryCards.innerHTML = summary
    .map(
      (item) => `
        <article class="stat-card">
          <p class="eyebrow">${safeText(item.label)}</p>
          <strong>${item.value}</strong>
          <p>${safeText(item.note)}</p>
        </article>
      `,
    )
    .join("");
}

function renderBookcases() {
  const bookcases = getBookcaseCounts();

  if (!bookcases.length) {
    elements.bookcaseGrid.innerHTML = `<div class="empty-state"><h3>No bookcases yet</h3><p>Add one to Firebase or keep the default shelves in place.</p></div>`;
    return;
  }

  elements.bookcaseGrid.innerHTML = bookcases
    .map((bookcase) => {
      const bookcaseBooks = state.books.filter((book) => book.bookcaseId === bookcase.id).slice(0, 6);
      const spines = bookcaseBooks.length
        ? bookcaseBooks
            .map((book) => {
              const height = 72 + ((hashString(book.name) % 40) + 40);
              return `<span class="spine" style="height:${height}px;background:linear-gradient(180deg, ${pickColor(book.name)}, rgba(255,255,255,0.16));"><span class="spine-label">${safeText(book.name.slice(0, 12))}</span></span>`;
            })
            .join("")
        : `<div class="empty-state"><p>No books here yet.</p></div>`;

      return `
        <article class="bookcase-card">
          <div class="bookcase-header">
            <div>
              <p class="eyebrow">${safeText(bookcase.note || "Bookcase")}</p>
              <h3>${safeText(bookcase.name)}</h3>
            </div>
            <span class="pill">${bookcase.count} books</span>
          </div>
          <div class="bookcase-books">${spines}</div>
        </article>
      `;
    })
    .join("");
}

function renderBooks() {
  const books = getFilteredBooks();
  elements.booksCountLabel.textContent = `${books.length} matching book${books.length === 1 ? "" : "s"}`;

  if (!books.length) {
    elements.booksGrid.innerHTML = `<div class="empty-state"><h3>No books match this search.</h3><p>Try clearing a filter or searching a different title, author, or reader.</p></div>`;
    return;
  }

  elements.booksGrid.innerHTML = books.map((book) => renderBookCard(book)).join("");
  elements.booksGrid.querySelectorAll("[data-book-id]").forEach((card) => {
    card.addEventListener("click", () => openBookModal(card.dataset.bookId));
  });
}

function renderBookCard(book) {
  const readers = normalizeReaders(book.readers);
  const label = getBookcaseLabel(book.bookcaseId);

  return `
    <article class="book-card" data-book-id="${safeText(book.id)}" tabindex="0" role="button" aria-label="Open ${safeText(book.name)}">
      <div class="book-cover">${createCoverMarkup(book)}</div>
      <div>
        <h4>${safeText(book.name)}</h4>
        <p class="book-meta">${safeText(book.author)}</p>
      </div>
      <div class="pill-row">
        <span class="pill">${safeText(label)}</span>
        <span class="pill">${readers.length} reader${readers.length === 1 ? "" : "s"}</span>
      </div>
    </article>
  `;
}

function renderStats() {
  const bookcaseCounts = getBookcaseCounts();
  const readerCounts = getReaderCounts();

  elements.statsGrid.innerHTML = bookcaseCounts
    .map(
      (bookcase) => `
        <article class="metric-card">
          <p class="eyebrow">${safeText(bookcase.name)}</p>
          <strong>${bookcase.count}</strong>
          <p>${safeText(bookcase.note || "Bookcase")}</p>
        </article>
      `,
    )
    .join("");

  elements.personStats.innerHTML = readerCounts
    .map(
      (reader) => `
        <article class="metric-card">
          <p class="eyebrow">${safeText(reader.reader)}</p>
          <strong>${reader.count}</strong>
          <p>books marked as read</p>
        </article>
      `,
    )
    .join("");
}

function setView(view) {
  state.view = view;
  refreshAll();
}

function openBookModal(bookId) {
  state.modalBookId = bookId;
  const book = state.books.find((entry) => entry.id === bookId);

  if (!book) {
    return;
  }

  elements.bookModal.classList.remove("hidden");
  elements.bookModal.setAttribute("aria-hidden", "false");
  renderDetailSummary(book);

  if (editForm) {
    populateForm(editForm, book);
  }
}

function closeBookModal() {
  state.modalBookId = null;
  elements.bookModal.classList.add("hidden");
  elements.bookModal.setAttribute("aria-hidden", "true");
}

function renderDetailSummary(book) {
  const readers = normalizeReaders(book.readers);
  elements.bookDetailSummary.innerHTML = `
    <section class="detail-summary">
      <div class="detail-pills">
        <span class="pill">${safeText(getBookcaseLabel(book.bookcaseId))}</span>
        <span class="pill">${readers.length} reader${readers.length === 1 ? "" : "s"}</span>
      </div>
      <h3>${safeText(book.name)}</h3>
      <p>${safeText(book.author)}</p>
      <div class="detail-grid">
        ${bookDetails(book)
          .map(
            ([label, value]) => `
              <div class="detail-field">
                <span>${safeText(label)}</span>
                <strong>${safeText(value)}</strong>
              </div>
            `,
          )
          .join("")}
      </div>
      <div class="detail-field">
        <span>Who has read this?</span>
        <div class="pill-row">${readers.length ? readers.map((reader) => `<span class="mini-pill">${safeText(reader)}</span>`).join("") : "<span class='pill'>No readers selected yet</span>"}</div>
      </div>
      <div class="detail-actions">
        <button class="secondary-btn" type="button" data-delete-book>Delete book</button>
        <button class="primary-btn" type="button" data-close-modal>Close</button>
      </div>
    </section>
  `;
}

function createBookForm(mode) {
  const template = elements.bookFormTemplate.content.cloneNode(true);
  const shell = template.querySelector(".book-form-shell");
  const kicker = template.querySelector("[data-form-kicker]");
  const title = template.querySelector("[data-form-title]");
  const copy = template.querySelector("[data-form-copy]");
  const form = template.querySelector("form");
  const submitLabel = template.querySelector("[data-submit-label]");
  const resetButton = template.querySelector("[data-reset-form]");
  const coverInput = form.elements.coverImage;
  const coverPreview = template.querySelector("[data-cover-preview]");

  kicker.textContent = mode === "edit" ? "Edit book" : "New record";
  title.textContent = mode === "edit" ? "Change every detail" : "Create a new book entry";
  copy.textContent = mode === "edit"
    ? "Update anything from the title to the readers list, then save straight into Firebase."
    : "Name and author are required. Everything else can be added now or later.";
  submitLabel.textContent = mode === "edit" ? "Save changes" : "Add book";
  resetButton.textContent = mode === "edit" ? "Revert" : "Clear form";

  renderBookcaseOptions(form);

  coverInput.addEventListener("input", () => updateCoverPreview(coverPreview, coverInput.value, form.elements.name.value));
  form.elements.name.addEventListener("input", () => {
    if (!coverInput.value) {
      updateCoverPreview(coverPreview, "", form.elements.name.value);
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await handleFormSubmit(form, mode);
  });

  resetButton.addEventListener("click", () => {
    if (mode === "edit" && state.modalBookId) {
      const original = state.books.find((book) => book.id === state.modalBookId);
      if (original) {
        populateForm(form, original);
      }
      return;
    }

    form.reset();
    updateCoverPreview(coverPreview, "", "");
  });

  shell.addEventListener("change", () => {
    if (mode === "edit" && state.modalBookId) {
      const original = state.books.find((book) => book.id === state.modalBookId);
      if (original) {
        updateCoverPreview(coverPreview, coverInput.value, form.elements.name.value || original.name);
      }
    }
  });

  return { element: shell, form, coverPreview };
}

function renderBookcaseOptions(form) {
  const select = form.elements.bookcaseId;
  const options = getBookcases();
  select.innerHTML = [
    `<option value="">Unsorted</option>`,
    ...options.map((bookcase) => `<option value="${safeText(bookcase.id)}">${safeText(bookcase.name)}</option>`),
  ].join("");
}

function syncAllBookcaseSelects() {
  [addForm, editForm].filter(Boolean).forEach((form) => {
    const currentValue = form.elements.bookcaseId.value;
    renderBookcaseOptions(form);
    if (currentValue) {
      form.elements.bookcaseId.value = currentValue;
    }
  });

  elements.bookcaseFilter.innerHTML = [
    `<option value="all">All bookcases</option>`,
    ...getBookcases().map((bookcase) => `<option value="${safeText(bookcase.id)}">${safeText(bookcase.name)}</option>`),
  ].join("");

  elements.readerFilter.innerHTML = [
    `<option value="all">All readers</option>`,
    ...readerNames.map((reader) => `<option value="${safeText(reader)}">${safeText(reader)}</option>`),
  ].join("");
}

function populateForm(form, book) {
  form.dataset.bookId = book?.id ?? "";
  form.elements.name.value = book?.name ?? "";
  form.elements.author.value = book?.author ?? "";
  form.elements.series.value = book?.series ?? "";
  form.elements.bookcaseId.value = book?.bookcaseId ?? "";
  form.elements.datePurchased.value = book?.datePurchased ?? "";
  form.elements.dateRead.value = book?.dateRead ?? "";
  form.elements.genre.value = book?.genre ?? "";
  form.elements.isbn.value = book?.isbn ?? "";
  form.elements.coverImage.value = book?.coverImage ?? "";
  form.elements.notes.value = book?.notes ?? "";

  const selectedReaders = new Set(normalizeReaders(book?.readers));
  form.querySelectorAll('input[name="readers"]').forEach((checkbox) => {
    checkbox.checked = selectedReaders.has(checkbox.value);
  });

  const coverPreview = form.querySelector("[data-cover-preview]");
  updateCoverPreview(coverPreview, form.elements.coverImage.value, form.elements.name.value);
}

function updateCoverPreview(container, url, title) {
  if (!container) {
    return;
  }

  if (url) {
    container.innerHTML = `<img src="${safeText(url)}" alt="Preview cover for ${safeText(title || "book")}" loading="lazy" />`;
    return;
  }

  container.innerHTML = `
    <div class="cover-placeholder">
      <strong>${safeText(title ? title.slice(0, 2).toUpperCase() : "NB")}</strong>
      <p>${safeText(title || "Add a cover image URL for a preview")}</p>
    </div>
  `;
}

function getFormPayload(form) {
  const readers = [...form.querySelectorAll('input[name="readers"]:checked')].map((checkbox) => checkbox.value);

  return {
    name: form.elements.name.value.trim(),
    author: form.elements.author.value.trim(),
    series: form.elements.series.value.trim(),
    bookcaseId: form.elements.bookcaseId.value || "",
    datePurchased: form.elements.datePurchased.value || "",
    dateRead: form.elements.dateRead.value || "",
    genre: form.elements.genre.value.trim(),
    isbn: form.elements.isbn.value.trim(),
    coverImage: form.elements.coverImage.value.trim(),
    notes: form.elements.notes.value.trim(),
    readers,
    updatedAt: new Date().toISOString(),
  };
}

async function handleFormSubmit(form, mode) {
  if (!state.firebaseReady || !booksRef) {
    showToast("Firebase is not connected yet.");
    return;
  }

  if (!form.elements.name.value.trim() || !form.elements.author.value.trim()) {
    showToast("Name and author are required.");
    return;
  }

  const payload = getFormPayload(form);

  try {
    if (mode === "edit" && state.modalBookId) {
      await update(ref(database, `books/${state.modalBookId}`), payload);
      showToast("Book updated.");
      closeBookModal();
    } else {
      const newEntry = push(booksRef);
      await set(newEntry, {
        ...payload,
        createdAt: new Date().toISOString(),
      });
      form.reset();
      updateCoverPreview(form.querySelector("[data-cover-preview]"), "", "");
      showToast("Book added.");
      setView("books");
    }
  } catch (error) {
    console.error(error);
    showToast("That save did not complete.");
  }
}

function mountForms() {
  const add = createBookForm("add");
  const edit = createBookForm("edit");
  addForm = add.form;
  editForm = edit.form;
  elements.addFormMount.replaceChildren(add.element);
  elements.editFormMount.replaceChildren(edit.element);
  populateForm(addForm, {});
  updateCoverPreview(add.coverPreview, "", "");
  updateCoverPreview(edit.coverPreview, "", "");
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  elements.toastStack.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2500);
}

function handleKeypadPress(value, action) {
  if (action === "clear") {
    state.passcodeBuffer = "";
    updatePasscodeUI();
    elements.loginStatus.textContent = "Cleared. Enter four digits to unlock the shelf.";
    return;
  }

  if (action === "backspace") {
    state.passcodeBuffer = state.passcodeBuffer.slice(0, -1);
    updatePasscodeUI();
    return;
  }

  if (!value || state.passcodeBuffer.length >= 4) {
    return;
  }

  state.passcodeBuffer += value;
  updatePasscodeUI();

  if (state.passcodeBuffer.length === 4) {
    if (state.passcodeBuffer === expectedPasscode) {
      unlockSite();
    } else {
      elements.loginStatus.textContent = "That code is not correct. Try again.";
      elements.loginOverlay.querySelector(".login-card").classList.add("shake");
      window.setTimeout(() => {
        elements.loginOverlay.querySelector(".login-card").classList.remove("shake");
        state.passcodeBuffer = "";
        updatePasscodeUI();
      }, 320);
    }
  }
}

function updatePasscodeUI() {
  elements.dots.forEach((dot, index) => {
    dot.classList.toggle("filled", index < state.passcodeBuffer.length);
  });
}

function unlockSite() {
  state.unlocked = true;
  elements.loginOverlay.classList.add("hidden");
  elements.loginStatus.textContent = "";
  state.passcodeBuffer = "";
  updatePasscodeUI();
  mountForms();
  syncAllBookcaseSelects();
  refreshAll();
  showToast("Unlocked.");
}

function bindEvents() {
  elements.keypad.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-digit], button[data-action]");
    if (!button) {
      return;
    }

    handleKeypadPress(button.dataset.digit, button.dataset.action);
  });

  elements.navButtons.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  elements.searchInput.addEventListener("input", () => {
    state.search = elements.searchInput.value;
    refreshAll();
  });

  elements.bookcaseFilter.addEventListener("change", () => {
    state.bookcaseFilter = elements.bookcaseFilter.value;
    renderBooks();
  });

  elements.readerFilter.addEventListener("change", () => {
    state.readerFilter = elements.readerFilter.value;
    renderBooks();
  });

  elements.clearFilters.addEventListener("click", () => {
    state.bookcaseFilter = "all";
    state.readerFilter = "all";
    state.search = "";
    elements.searchInput.value = "";
    elements.bookcaseFilter.value = "all";
    elements.readerFilter.value = "all";
    refreshAll();
  });

  elements.openAddBookTop.addEventListener("click", () => setView("add"));

  elements.bookModal.addEventListener("click", (event) => {
    if (event.target.matches("[data-delete-book]")) {
      deleteCurrentBook();
      return;
    }

    if (event.target.matches("[data-close-modal]")) {
      closeBookModal();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.bookModal.classList.contains("hidden")) {
      closeBookModal();
    }
  });
}

async function deleteCurrentBook() {
  if (!state.modalBookId || !state.firebaseReady) {
    return;
  }

  const book = state.books.find((entry) => entry.id === state.modalBookId);
  const confirmed = window.confirm(`Delete ${book?.name ?? "this book"}? This cannot be undone.`);

  if (!confirmed) {
    return;
  }

  try {
    await remove(ref(database, `books/${state.modalBookId}`));
    showToast("Book deleted.");
    closeBookModal();
  } catch (error) {
    console.error(error);
    showToast("That delete did not complete.");
  }
}

function renderInitialEmptyState() {
  elements.summaryCards.innerHTML = `
    <article class="stat-card"><p class="eyebrow">Loading</p><strong>...</strong><p>Waiting for the library data.</p></article>
  `;
  elements.bookcaseGrid.innerHTML = `<div class="empty-state"><h3>Loading shelves...</h3><p>The app is connecting to Firebase.</p></div>`;
  elements.booksGrid.innerHTML = `<div class="empty-state"><h3>Loading books...</h3><p>The app is connecting to Firebase.</p></div>`;
  elements.statsGrid.innerHTML = `<div class="empty-state"><h3>Loading stats...</h3><p>The app is connecting to Firebase.</p></div>`;
  elements.personStats.innerHTML = `<div class="empty-state"><h3>Loading people...</h3><p>The app is connecting to Firebase.</p></div>`;
}

function init() {
  bindEvents();
  renderInitialEmptyState();
  updatePasscodeUI();
  initFirebase();
  state.unlocked = false;
}

init();