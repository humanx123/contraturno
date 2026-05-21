(function(){
"use strict";


/* kept V3 marker */
function dbDelete(key){
  return openDb().then(function(db){
    return new Promise(function(resolve, reject){
      var tx = db.transaction("kv", "readwrite");
      var req = tx.objectStore("kv").delete(key);

      req.onsuccess = function(){ resolve(true); };
      req.onerror = function(){ reject(req.error); };
    });
  });
}

function clonePlain(obj){
  return JSON.parse(JSON.stringify(obj || {}));
}

function currentUserName(){
  if (!state.user) return "";
  return state.user.nickname || state.user.email || "";
}

function isPublishedMine(z){
  if (!state.user || !z) return false;

  var uid = state.user.id || "";
  var nick = state.user.nickname || "";
  var email = state.user.email || "";

  return (
    z.userId === uid ||
    z.user_id === uid ||
    z.authorId === uid ||
    z.author_id === uid ||
    authorOf(z) === nick ||
    authorOf(z) === email
  );
}

function draftMetaFromDraft(d){
  return {
    id: d.localId,
    title: d.title || "Sin titulo",
    description: d.description || "",
    pageCount: Array.isArray(d.pages) ? d.pages.length : 0,
    updatedAt: d.updatedAt || new Date().toISOString(),
    publishedId: d.publishedId || null,
    publishedTitle: d.publishedTitle || null
  };
}

function loadDraftIndex(){
  return dbGet("draftIndex").then(function(idx){
    if (Array.isArray(idx)) return idx;
    return [];
  }).catch(function(){
    return [];
  });
}

function saveDraftIndex(idx){
  idx = Array.isArray(idx) ? idx : [];

  idx.sort(function(a,b){
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });

  return dbSet("draftIndex", idx);
}

function saveDraftRecord(silent){
  if (!state.draft) return Promise.resolve(false);

  normalize();

  if (!state.draft.localId) {
    state.draft.localId = uid();
  }

  state.draft.updatedAt = new Date().toISOString();

  var copy = clonePlain(state.draft);

  return dbSet("draft:" + state.draft.localId, copy)
    .then(function(){
      return loadDraftIndex();
    })
    .then(function(idx){
      var meta = draftMetaFromDraft(copy);
      var found = false;

      idx = idx.map(function(item){
        if (item.id === meta.id) {
          found = true;
          return meta;
        }

        return item;
      });

      if (!found) idx.push(meta);

      return saveDraftIndex(idx);
    })
    .then(function(){
      return true;
    });
}

function listLocalDrafts(){
  return loadDraftIndex().then(function(idx){
    idx.sort(function(a,b){
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });

    return idx;
  });
}

function openLocalDraft(id){
  return dbGet("draft:" + id).then(function(d){
    if (!d || !Array.isArray(d.pages)) {
      alert("No se encontro el borrador.");
      return;
    }

    state.draft = d;
    normalize();

    state.selectedPage = state.draft.pages[0].id;
    state.selectedEl = null;
    state.spread = findSpread(state.selectedPage);

    return dbSet("draft", state.draft).then(function(){
      nav("/studio");
    });
  }).catch(function(e){
    alert("No pude abrir el borrador: " + (e.message || e));
  });
}

function deleteLocalDraft(id){
  if (!confirm("Eliminar este borrador local?")) return;

  return dbDelete("draft:" + id)
    .then(function(){
      return loadDraftIndex();
    })
    .then(function(idx){
      idx = idx.filter(function(item){
        return item.id !== id;
      });

      return saveDraftIndex(idx);
    })
    .then(function(){
      if (state.draft && state.draft.localId === id) {
        state.draft = makeDraft("Nuevo fanzine");
        state.selectedPage = state.draft.pages[0].id;
        state.selectedEl = null;
        state.spread = 0;
        return dbSet("draft", state.draft);
      }
    })
    .then(function(){
      renderMyFanzines();
    })
    .catch(function(e){
      alert("No pude eliminar: " + (e.message || e));
    });
}

function duplicateLocalDraft(id){
  return dbGet("draft:" + id).then(function(d){
    if (!d || !Array.isArray(d.pages)) {
      alert("No se encontro el borrador.");
      return;
    }

    var copy = clonePlain(d);
    copy.localId = uid();
    copy.publishedId = null;
    copy.title = (copy.title || "Fanzine") + " copia";
    copy.updatedAt = new Date().toISOString();

    return dbSet("draft:" + copy.localId, copy)
      .then(function(){
        return loadDraftIndex();
      })
      .then(function(idx){
        idx.push(draftMetaFromDraft(copy));
        return saveDraftIndex(idx);
      })
      .then(function(){
        renderMyFanzines();
      });
  }).catch(function(e){
    alert("No pude duplicar: " + (e.message || e));
  });
}

function downloadLocalDraft(id){
  dbGet("draft:" + id).then(function(d){
    if (!d) {
      alert("No se encontro el borrador.");
      return;
    }

    var blob = new Blob([JSON.stringify(d, null, 2)], {
      type: "application/json"
    });

    var a = document.createElement("a");
    var safe = String(d.title || "fanzine")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "fanzine";

    a.href = URL.createObjectURL(blob);
    a.download = safe + "-draft.json";
    a.click();

    setTimeout(function(){
      URL.revokeObjectURL(a.href);
    }, 1000);
  });
}

function openPublishedForEdit(id){
  var z = state.published.find(function(item){
    return item.id === id;
  });

  if (!z) {
    alert("No se encontro la publicacion.");
    return;
  }

  if (!isPublishedMine(z)) {
    alert("Solo puedes editar fanzines publicados por tu usuario.");
    return;
  }

  var pages = pagesOf(z);

  if (!pages.length) {
    alert("La publicacion no contiene paginas editables.");
    return;
  }

  var d = {
    localId: uid(),
    publishedId: z.id,
    publishedTitle: z.title || "Fanzine publicado",
    title: z.title || "Fanzine publicado",
    description: z.description || z.summary || "",
    pageSize: z.pageSize || z.page_size || "Carta",
    bg: pages[0] && pages[0].bg ? pages[0].bg : "#fff4df",
    margin: 42,
    margins: true,
    allowDownload: z.allowDownload !== false,
    allowShare: z.allowShare !== false,
    pages: clonePlain(pages),
    updatedAt: new Date().toISOString()
  };

  state.draft = d;
  normalize();

  state.selectedPage = state.draft.pages[0].id;
  state.selectedEl = null;
  state.spread = findSpread(state.selectedPage);

  return dbSet("draft", state.draft)
    .then(function(){
      return saveDraftRecord(false);
    })
    .then(function(){
      nav("/studio");
    });
}

function dateShort(v){
  if (!v) return "";

  try {
    return new Date(v).toLocaleString();
  } catch(e) {
    return String(v);
  }
}

function previewTextFromPages(pages, fallback){
  try {
    if (pages && pages[0] && Array.isArray(pages[0].elements)) {
      var t = pages[0].elements.find(function(el){
        return el.type === "text";
      });

      if (t && t.text) return t.text;
    }
  } catch(e) {}

  return fallback || "Fanzine";
}

function makeMyCard(kind, item, actions){
  var card = ce("article", "zine-card my-zine-card");

  var preview = ce("div", "preview-wrap");
  preview.appendChild(ce("div", "preview-page", item.preview || item.title || "Fanzine"));
  card.appendChild(preview);

  var tag = ce("div", "my-tag " + (kind === "published" ? "published" : "draft"), kind === "published" ? "PUBLICADO" : "BORRADOR");
  card.appendChild(tag);

  card.appendChild(ce("h2", "", item.title || "Sin titulo"));

  if (item.meta) {
    card.appendChild(ce("p", "", item.meta));
  }

  if (item.date) {
    card.appendChild(ce("p", "", "Actualizado: " + item.date));
  }

  var area = ce("div", "zine-actions");

  actions.forEach(function(a){
    area.appendChild(button(a.label, a.cls || "secondary", a.fn));
  });

  card.appendChild(area);

  return card;
}

function fillMyFanzines(){
  var grid = document.getElementById("myFanzinesGrid");
  if (!grid) return;

  clear(grid);

  var qNode = document.getElementById("myFanzinesSearch");
  var q = qNode ? String(qNode.value || "").toLowerCase().trim() : "";

  return listLocalDrafts().then(function(drafts){
    var ownedPublished = state.published.filter(isPublishedMine);

    var draftTitle = ce("div", "my-section-title");
    draftTitle.textContent = "Borradores locales";
    grid.appendChild(draftTitle);

    var draftCount = 0;

    drafts.forEach(function(d){
      var hay = String(d.title || "").toLowerCase();

      if (q && !hay.includes(q)) return;

      draftCount += 1;

      grid.appendChild(makeMyCard("draft", {
        title: d.title,
        preview: d.title,
        meta: String(d.pageCount || 0) + " paginas" + (d.publishedId ? " - vinculado a publicacion" : ""),
        date: dateShort(d.updatedAt)
      }, [
        { label:"Editar", cls:"primary", fn:function(){ openLocalDraft(d.id); } },
        { label:"Duplicar", cls:"secondary", fn:function(){ duplicateLocalDraft(d.id); } },
        { label:"Descargar JSON", cls:"secondary", fn:function(){ downloadLocalDraft(d.id); } },
        { label:"Eliminar", cls:"danger", fn:function(){ deleteLocalDraft(d.id); } }
      ]));
    });

    if (!draftCount) {
      var emptyDrafts = ce("article", "card my-empty");
      emptyDrafts.textContent = "No hay borradores locales.";
      grid.appendChild(emptyDrafts);
    }

    var pubTitle = ce("div", "my-section-title");
    pubTitle.textContent = "Publicados por mi usuario";
    grid.appendChild(pubTitle);

    var pubCount = 0;

    ownedPublished.forEach(function(z){
      var pages = pagesOf(z);
      var title = z.title || "Sin titulo";
      var hay = (title + " " + authorOf(z)).toLowerCase();

      if (q && !hay.includes(q)) return;

      pubCount += 1;

      grid.appendChild(makeMyCard("published", {
        title: title,
        preview: previewTextFromPages(pages, title),
        meta: String(z.pageCount || z.page_count || pages.length || 0) + " paginas - Autor: " + authorOf(z),
        date: dateShort(z.updatedAt || z.updated_at || z.createdAt || z.created_at)
      }, [
        { label:"Editar publicacion", cls:"primary", fn:function(){ openPublishedForEdit(z.id); } },
        { label:"Leer", cls:"secondary", fn:function(){ openReader(z.id); } },
        { label:"Descargar", cls:"secondary", fn:function(){ downloadZine(z.id); } },
        { label:"Eliminar", cls:"danger", fn:function(){ deleteZine(z.id); } }
      ]));
    });

    if (!pubCount) {
      var emptyPubs = ce("article", "card my-empty");
      emptyPubs.textContent = "No hay publicaciones de este usuario.";
      grid.appendChild(emptyPubs);
    }
  }).catch(function(e){
    clear(grid);
    grid.appendChild(ce("article", "card my-empty", "Error cargando Mis Fanzines: " + (e.message || e)));
  });
}

function renderMyFanzines(){
  shell("Mis Fanzines", "Administra borradores locales y publicaciones de tu usuario.", function(main){
    var bar = ce("div", "my-toolbar");

    var search = ce("input");
    search.id = "myFanzinesSearch";
    search.className = "search";
    search.placeholder = "Buscar en mis fanzines...";
    search.addEventListener("input", fillMyFanzines);

    bar.appendChild(search);
    bar.appendChild(button("Nuevo fanzine", "primary", function(){
      newDraft();
    }));
    bar.appendChild(button("Ir al Lab", "secondary", function(){
      nav("/studio");
    }));

    main.appendChild(bar);

    var note = ce("article", "card my-note");
    note.textContent = "Los borradores se guardan localmente en este navegador. Las publicaciones son las que ya aparecen en el Hub. Si editas una publicacion, al publicar se actualiza o se reemplaza por una nueva version si el backend no permite update directo.";
    main.appendChild(note);

    var grid = ce("section", "hub-grid my-grid");
    grid.id = "myFanzinesGrid";
    grid.appendChild(ce("article", "card my-empty", "Cargando..."));
    main.appendChild(grid);

    fillMyFanzines();
  });
}




/* kept V3 marker */

/* removed duplicate dbDelete */



/* removed duplicate clonePlain */



/* removed duplicate currentUserName */



/* removed duplicate isPublishedMine */



/* removed duplicate draftMetaFromDraft */



/* removed duplicate loadDraftIndex */



/* removed duplicate saveDraftIndex */



/* removed duplicate saveDraftRecord */



/* removed duplicate listLocalDrafts */



/* removed duplicate openLocalDraft */



/* removed duplicate deleteLocalDraft */



/* removed duplicate duplicateLocalDraft */



/* removed duplicate downloadLocalDraft */



/* removed duplicate openPublishedForEdit */



/* removed duplicate dateShort */



/* removed duplicate previewTextFromPages */



/* removed duplicate makeMyCard */



/* removed duplicate fillMyFanzines */



/* removed duplicate renderMyFanzines */







/* removed duplicate dbDelete */



/* removed duplicate clonePlain */



/* removed duplicate currentUserName */



/* removed duplicate isPublishedMine */



/* removed duplicate draftMetaFromDraft */



/* removed duplicate loadDraftIndex */



/* removed duplicate saveDraftIndex */



/* removed duplicate saveDraftRecord */



/* removed duplicate listLocalDrafts */



/* removed duplicate openLocalDraft */



/* removed duplicate deleteLocalDraft */



/* removed duplicate duplicateLocalDraft */



/* removed duplicate downloadLocalDraft */



/* removed duplicate openPublishedForEdit */



/* removed duplicate dateShort */



/* removed duplicate previewTextFromPages */



/* removed duplicate makeMyCard */



/* removed duplicate fillMyFanzines */



/* removed duplicate renderMyFanzines */




var app = document.getElementById("app");
var state = {
  user: null,
  published: [],
  search: "",
  draft: null,
  selectedPage: null,
  selectedEl: null,
  spread: 0,
  reader: null,
  readerSpread: 0,
  drag: null,
  supportActive: false,
  supportPoints: 0,
  supportTimer: null,
  supportMinerClient: null,
  supportMinerScriptLoaded: false,
  supportMinerError: null
};

var SAVE_DEBOUNCE_MS = 800;
var SAVE_TIMER = null;
var SAVE_BUSY = false;
var SAVE_PENDING = false;
var SAVE_LAST_ERROR = null;

function updateSaveStatus(message, mode){
  var node = document.getElementById("saveStatus");
  if (!node) return;

  node.textContent = message || "";

  node.classList.remove("ok", "warn", "dirty");

  if (mode) {
    node.classList.add(mode);
  }
}

function approxDraftMb(){
  try {
    return (JSON.stringify(state.draft || {}).length / 1024 / 1024).toFixed(2);
  } catch(e) {
    return "0.00";
  }
}

function deleteDbSafe(name){
  return new Promise(function(resolve){
    try {
      var req = indexedDB.deleteDatabase(name);

      req.onsuccess = function(){ resolve(true); };
      req.onerror = function(){ resolve(false); };
      req.onblocked = function(){ resolve(false); };
    } catch(e) {
      resolve(false);
    }
  });
}

async function clearStudioStorage(){
  if (!confirm("Esto limpiara el borrador local del navegador. Si quieres conservarlo, usa primero Descargar proyecto. Continuar?")) {
    return;
  }

  try {
    await deleteDbSafe("fanzine_lab_studio_v1");
    await deleteDbSafe("fanzine_lab_studio_v2");
    await deleteDbSafe("fanzine_lab_studio_v3_textsafe");
    await deleteDbSafe("fanzine_lab_studio_v4_textsafe");
    await deleteDbSafe("fanzine_lab_studio_v5_fluid_text");
  } catch(e) {}

  state.draft = makeDraft("Nuevo fanzine");
  state.selectedPage = state.draft.pages[0].id;
  state.selectedEl = null;
  state.spread = 0;

  try {
    await dbSet("draft", state.draft);
  } catch(e) {}

  alert("Borrador local limpiado. Se creo un fanzine nuevo.");
  renderStudio();
}

function ce(tag, cls, text){
  var el = document.createElement(tag);
  if(cls) el.className = cls;
  if(text != null) el.textContent = text;
  return el;
}
function clear(node){ while(node.firstChild) node.removeChild(node.firstChild); }
function uid(){ return "id_" + Math.random().toString(36).slice(2) + Date.now().toString(36); }
function route(){ return location.pathname.replace(/\/+$/, "") || "/"; }
function nav(path){ history.pushState({}, "", path); render(); }
window.addEventListener("popstate", render);

async function api(path, opts){
  opts = opts || {};
  var init = { method: opts.method || "GET", credentials: "include", headers: { "Content-Type": "application/json" } };
  if(opts.body !== undefined) init.body = JSON.stringify(opts.body);
  var res = await fetch(path, init);
  var text = await res.text();
  var data = {};
  try { data = text ? JSON.parse(text) : {}; } catch(e){ data = { raw: text }; }
  if(!res.ok) throw new Error(data.error || data.message || text || "API error");
  return data;
}

function openDb(){
  return new Promise(function(resolve, reject){
    var req = indexedDB.open("fanzine_lab_studio_v5_fluid_text", 1);
    req.onupgradeneeded = function(){
      var db = req.result;
      if(!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = function(){ resolve(req.result); };
    req.onerror = function(){ reject(req.error); };
  });
}
async function dbGet(key){
  var db = await openDb();
  return new Promise(function(resolve, reject){
    var tx = db.transaction("kv", "readonly");
    var req = tx.objectStore("kv").get(key);
    req.onsuccess = function(){ resolve(req.result); };
    req.onerror = function(){ reject(req.error); };
  });
}
async function dbSet(key, val){
  var db = await openDb();
  return new Promise(function(resolve, reject){
    var tx = db.transaction("kv", "readwrite");
    var req = tx.objectStore("kv").put(val, key);
    req.onsuccess = function(){ resolve(true); };
    req.onerror = function(){ reject(req.error); };
  });
}

function textBox(text,x,y,w,h,size,bold){
  return { id:uid(), type:"text", text:text||"Texto", x:x||60, y:y||90, w:w||320, h:h||100, font:"Bricolage Grotesque", size:size||34, color:"#111111", bold:!!bold, italic:false, align:"left" };
}
function imageBox(src){
  return { id:uid(), type:"image", src:src||"", x:80, y:220, w:340, h:240, fit:"contain", cropX:50, cropY:50, zoom:1 };
}
function makeDraft(title){
  title = title || "Nuevo fanzine";
  return {
    title:title, description:"Publicacion editorial DIY", pageSize:"Carta", bg:"#fff4df", margin:42, margins:true,
    allowDownload:true, allowShare:true,
    pages:[
      { id:uid(), bg:"#fff4df", elements:[ textBox(title,54,75,420,110,52,true), textBox("Editorial DIY",58,190,360,70,24,false) ] },
      { id:uid(), bg:"#fff4df", elements:[ textBox("Pagina 2",54,75,340,90,36,true) ] },
      { id:uid(), bg:"#fff4df", elements:[ textBox("Pagina 3",54,75,340,90,36,true) ] },
      { id:uid(), bg:"#fff4df", elements:[ textBox("Fin / Contraportada",54,75,420,90,32,true) ] }
    ]
  };
}
async function loadDraft(){
  try{
    var d = await dbGet("draft");
    if(d && Array.isArray(d.pages) && d.pages.length) return d;
  }catch(e){ console.warn(e); }
  return makeDraft("Nuevo fanzine");
}
function normalize(){
  if(!state.draft) state.draft = makeDraft("Nuevo fanzine");
  if(!Array.isArray(state.draft.pages) || !state.draft.pages.length) state.draft.pages = makeDraft(state.draft.title).pages;
  if(!state.selectedPage) state.selectedPage = state.draft.pages[0].id;
  state.draft.pages.forEach(function(p){
    if(!p.id) p.id = uid();
    if(!p.bg) p.bg = state.draft.bg || "#fff4df";
    if(!Array.isArray(p.elements)) p.elements = [];
    p.elements.forEach(function(el){
      if(!el.id) el.id = uid();
      if(el.type === "image"){
        if(!el.fit) el.fit = "contain";
        if(el.cropX == null) el.cropX = 50;
        if(el.cropY == null) el.cropY = 50;
        if(!el.zoom) el.zoom = 1;
      }
    });
  });
}
function save(){
  updateSaveStatus("Cambios sin guardar...", "dirty");

  if (SAVE_TIMER) {
    clearTimeout(SAVE_TIMER);
    SAVE_TIMER = null;
  }

  SAVE_TIMER = setTimeout(function(){
    saveNow(false);
  }, SAVE_DEBOUNCE_MS);
}

async function saveNow(notify){
  if (!state.draft) return false;

  if (SAVE_BUSY) {
    SAVE_PENDING = true;
    return false;
  }

  SAVE_BUSY = true;
  SAVE_PENDING = false;

  try {
    await dbSet("draft", state.draft);

    SAVE_LAST_ERROR = null;
    updateSaveStatus("Guardado local. Peso aprox: " + approxDraftMb() + " MB", "ok");

    if (notify) {
      alert("Proyecto guardado localmente.");
    }

    SAVE_BUSY = false;

    if (SAVE_PENDING) {
      SAVE_PENDING = false;
      saveNow(false);
    }

    return true;
  } catch(e) {
    SAVE_LAST_ERROR = e && e.message ? e.message : String(e);

    updateSaveStatus("No se pudo guardar localmente. Puedes seguir editando y descargar proyecto. Error: " + SAVE_LAST_ERROR, "warn");

    console.warn("Fanzine Lab save failed:", e);

    if (notify) {
      alert("No se pudo guardar localmente. Descarga el proyecto JSON antes de cerrar. Error: " + SAVE_LAST_ERROR);
    }

    SAVE_BUSY = false;
    return false;
  }
}

function compress(dataUrl, maxSide, quality){
  maxSide = maxSide || 1500; quality = quality || 0.82;
  return new Promise(function(resolve){
    if(!dataUrl || !String(dataUrl).startsWith("data:image/")){ resolve(dataUrl); return; }
    var img = new Image();
    img.onload = function(){
      try{
        var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        var s = Math.min(1, maxSide / Math.max(w,h));
        var c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w*s)); c.height = Math.max(1, Math.round(h*s));
        c.getContext("2d").drawImage(img,0,0,c.width,c.height);
        var out = c.toDataURL("image/jpeg", quality);
        resolve(out && out.length < dataUrl.length ? out : dataUrl);
      }catch(e){ resolve(dataUrl); }
    };
    img.onerror = function(){ resolve(dataUrl); };
    img.src = dataUrl;
  });
}
function fileToData(file){
  return new Promise(function(resolve, reject){
    var r = new FileReader();
    r.onload = async function(){ try{ resolve(await compress(String(r.result || ""))); }catch(e){ reject(e); } };
    r.onerror = function(){ reject(r.error || new Error("No se pudo leer imagen")); };
    r.readAsDataURL(file);
  });
}

async function refreshUser(){
  try{ var d = await api("/api/auth/me"); state.user = d.user || null; }
  catch(e){ state.user = null; }
}
async function refreshPublished(){
  try{ var d = await api("/api/published"); state.published = Array.isArray(d) ? d : (d.items || []); }
  catch(e){ state.published = []; }
}

function button(label, cls, fn){ var b = ce("button", cls || "btn", label); b.addEventListener("click", fn); return b; }
function input(value, oninput, type){ var i = ce("input"); i.value = value || ""; if(type) i.type = type; i.addEventListener("input", function(){ oninput(i.value); }); return i; }
function textarea(value, oninput){ var t = ce("textarea"); t.value = value || ""; t.addEventListener("input", function(){ oninput(t.value); }); return t; }
function select(value, opts, onchange){ var s = ce("select"); opts.forEach(function(o){ var op = ce("option", "", o.label); op.value = o.value; if(o.value === value) op.selected = true; s.appendChild(op); }); s.addEventListener("change", function(){ onchange(s.value); }); return s; }
function label(name, control){ var l = ce("label", "", name); l.appendChild(control); return l; }

function shell(title, sub, contentBuilder){
  clear(app);
  var shell = ce("div", "app");
  var side = ce("aside", "sidebar");
  var brand = ce("div", "brand"); brand.appendChild(ce("div", "logo", "FL"));
  var bt = ce("div"); bt.appendChild(ce("div", "brand-title", "Fanzine Lab & Hub")); bt.appendChild(ce("div", "brand-sub", "Editorial DIY")); brand.appendChild(bt); side.appendChild(brand);
  var navBox = ce("nav", "nav");
  navBox.appendChild(button("Inicio", "btn", function(){nav("/");}));
  navBox.appendChild(button("Hub", "btn", function(){nav("/hub");}));
  navBox.appendChild(button("Lab", "btn", function(){nav("/studio");}));
  navBox.appendChild(button("Mis Fanzines", "btn", function(){nav("/my-fanzines");}));
  navBox.appendChild(button("Cuenta", "btn", function(){nav("/login");})); navBox.appendChild(button("Apoyar", "support-btn", function(){nav("/support");}));
  side.appendChild(navBox);
  var acct = ce("div", "account account-card");
  if(state.user){ acct.appendChild(ce("div", "account-name", state.user.nickname || state.user.email || "usuario")); acct.appendChild(button("Lab", "btn", function(){nav("/studio");}));
  acct.appendChild(button("Mis Fanzines", "btn", function(){nav("/my-fanzines");})); acct.appendChild(button("Hub", "btn", function(){nav("/hub");})); acct.appendChild(button("Salir", "danger", logout)); }
  else { acct.appendChild(button("Registrarme", "primary", function(){nav("/register");})); acct.appendChild(button("Iniciar sesion", "btn", function(){nav("/login");})); acct.appendChild(button("Recuperar", "btn", function(){nav("/recover");})); }
  side.appendChild(acct);
  var main = ce("main", "main");
  var top = ce("section", "topbar"); var topText = ce("div"); topText.appendChild(ce("h1", "", title)); topText.appendChild(ce("p", "", sub || "")); top.appendChild(topText); main.appendChild(top);
  contentBuilder(main);
  shell.appendChild(side); shell.appendChild(main); app.appendChild(shell);
}

function renderLanding(){
  shell("Fanzine Lab & Hub", "Crear, leer, publicar y compartir fanzines.", function(main){
    var wrap = ce("section", "landing");
    var c = ce("article", "card"); c.appendChild(ce("div", "logo big-logo", "FL")); c.appendChild(ce("div", "chip", "EDITORIAL DIY - FANZINES - COMUNIDAD CRITICA")); c.appendChild(ce("h2", "", "FANZINE\nLAB & HUB")); c.appendChild(ce("p", "", "Plataforma web para crear, editar, imprimir y compartir fanzines. Un laboratorio editorial local-first, punk, artistico, democratico y critico: una herramienta para hacer fanzines, crear arte y compartir pensamiento visual.")); var row=ce("div","row"); row.appendChild(button("Acceso al Hub","primary",function(){nav("/hub");})); row.appendChild(button("Crear fanzine","secondary",function(){nav("/studio");})); c.appendChild(row); wrap.appendChild(c);
    var m=ce("article","card"); m.appendChild(ce("h3","","Manifiesto")); m.appendChild(ce("p","","Fanzine Lab nace para recuperar autonomia editorial: escribir, disenar, hacer arte, imprimir, publicar y discutir sin depender de plataformas cerradas.")); wrap.appendChild(m);
    var code=ce("article","card"); code.appendChild(ce("h3","","Codigo editorial")); code.appendChild(ce("p","","Libertad intelectual, respeto, autoria y responsabilidad. Cada autor conserva sus derechos y responde por lo que publica.")); wrap.appendChild(code);
    main.appendChild(wrap);
  });
}

function authCard(title, fields, actions){
  shell(title, "Acceso a Fanzine Lab.", function(main){
    var wrap=ce("section","auth-wrap"); var card=ce("article","auth-card"); card.appendChild(ce("h2","",title)); fields(card); actions(card); wrap.appendChild(card); main.appendChild(wrap);
  });
}
function renderLogin(){ authCard("Iniciar sesion", function(c){ c.appendChild(input("", function(){}, "text")); c.lastChild.id="loginId"; c.lastChild.placeholder="Nickname o correo"; c.appendChild(input("", function(){}, "password")); c.lastChild.id="loginPass"; c.lastChild.placeholder="Contrasena"; }, function(c){ c.appendChild(button("Entrar","primary",login)); c.appendChild(button("Olvide mi contrasena","secondary",function(){nav("/recover");})); c.appendChild(button("Crear cuenta","secondary",function(){nav("/register");})); }); }
function renderRegister(){ authCard("Crear cuenta", function(c){ c.appendChild(input("",function(){},"text")); c.lastChild.id="regNick"; c.lastChild.placeholder="Nickname"; c.appendChild(input("",function(){},"text")); c.lastChild.id="regEmail"; c.lastChild.placeholder="Correo"; c.appendChild(input("",function(){},"password")); c.lastChild.id="regPass"; c.lastChild.placeholder="Contrasena"; }, function(c){ c.appendChild(button("Registrarme","primary",registerUser)); c.appendChild(button("Ya tengo cuenta","secondary",function(){nav("/login");})); }); }
function renderRecover(){ authCard("Recuperar contrasena", function(c){ c.appendChild(input("",function(){},"text")); c.lastChild.id="recId"; c.lastChild.placeholder="Nickname o correo"; c.appendChild(input("",function(){},"text")); c.lastChild.id="recCode"; c.lastChild.placeholder="Codigo de recuperacion"; c.appendChild(input("",function(){},"password")); c.lastChild.id="recPass"; c.lastChild.placeholder="Nueva contrasena"; }, function(c){ c.appendChild(button("Cambiar contrasena","primary",recoverPassword)); c.appendChild(button("Volver","secondary",function(){nav("/login");})); }); }

function pagesOf(z){ try{ if(Array.isArray(z.pages)) return z.pages; return JSON.parse(z.pagesJson || z.pages_json || "[]"); }catch(e){ return []; } }
function authorOf(z){ return z.authorName || z.author_name || z.authorNickname || "Anonimo"; }

function renderSupport(){
  shell("Apoyar Fanzine Lab", "Donacion voluntaria de computo para sostener servidor, dominio y desarrollo.", function(main){
    var wrap = ce("section", "support-page");

    var intro = ce("article", "card support-hero");
    intro.appendChild(ce("div", "logo big-logo", "FL"));
    intro.appendChild(ce("div", "chip", "APOYO VOLUNTARIO - COMPUTO - COMUNIDAD"));
    intro.appendChild(ce("h2", "", "DONAR\nCOMPUTO"));

    intro.appendChild(ce("p", "", "Puedes apoyar el mantenimiento de Fanzine Lab dejando esta pagina abierta de forma voluntaria. El objetivo es ayudar a sostener costos de servidor, dominio, desarrollo y archivo comunitario."));

    var consent = ce("label", "support-consent");
    var check = ce("input");
    check.type = "checkbox";
    check.id = "supportConsent";
    consent.appendChild(check);
    consent.appendChild(ce("span", "", "Acepto iniciar voluntariamente el apoyo con computo en mi navegador. Entiendo que puede usar CPU, que puedo detenerlo cuando quiera y que no es obligatorio para leer, crear o publicar."));
    intro.appendChild(consent);

    var throttleBox = ce("div", "support-throttle");
    throttleBox.appendChild(ce("label", "", "Intensidad"));
    var throttle = ce("select");
    throttle.id = "supportThrottle";

    [
      { value: "0.80", label: "Baja - 20% CPU aprox." },
      { value: "0.60", label: "Media - 40% CPU aprox." },
      { value: "0.20", label: "Alta - 80% CPU aprox." }
    ].forEach(function(item){
      var op = ce("option", "", item.label);
      op.value = item.value;
      if (item.value === "0.80") op.selected = true;
      throttle.appendChild(op);
    });

    throttleBox.appendChild(throttle);
    intro.appendChild(throttleBox);

    var row = ce("div", "row");
    row.appendChild(button("Iniciar apoyo", "primary", startSupportDemo));
    row.appendChild(button("Detener", "danger", stopSupportDemo));
    row.appendChild(button("Volver al Hub", "secondary", function(){ nav("/hub"); }));
    intro.appendChild(row);

    var status = ce("div", "support-status");
    status.id = "supportStatus";
    status.textContent = state.supportActive ? "Apoyo activo. Puntos simbolicos: " + state.supportPoints : "Apoyo detenido. Nada corre sin tu consentimiento.";
    intro.appendChild(status);

    var detail = ce("div", "support-mini");
    detail.id = "supportTechnicalStatus";
    detail.textContent = "Proveedor externo: inactivo. Se carga solo despues de aceptar e iniciar.";
    intro.appendChild(detail);

    wrap.appendChild(intro);

    var ethics = ce("article", "card support-grid");
    ethics.appendChild(supportItem("Consentimiento", "El apoyo con computo no inicia automaticamente. La persona debe activarlo de forma explicita."));
    ethics.appendChild(supportItem("Transparencia", "La pagina informa que usa recursos del navegador y permite detener el proceso en cualquier momento."));
    ethics.appendChild(supportItem("Sin bloqueo", "No se bloquea el acceso por no donar computo, usar adblock o navegar en modo privado."));
    ethics.appendChild(supportItem("Puntos simbolicos", "Los puntos de apoyo son reconocimiento comunitario interno. No son dinero, inversion ni promesa de ganancia."));
    ethics.appendChild(supportItem("Responsabilidad", "El administrador debe publicar reglas claras antes de activar recompensas, tokens o beneficios."));
    ethics.appendChild(supportItem("Alternativas", "Tambien se pueden habilitar donaciones directas, patrocinios o apoyo institucional."));

    wrap.appendChild(ethics);

    var note = ce("article", "card support-note");
    note.appendChild(ce("h2", "", "Politica de uso"));
    note.appendChild(ce("p", "", "El apoyo con computo es voluntario. Puedes cerrar esta pagina o pulsar Detener en cualquier momento. Fanzine Lab no condiciona el acceso al Hub ni al Studio a esta forma de apoyo."));
    note.appendChild(ce("p", "", "Antes de activar tokens reales o recompensas con valor economico, se deben definir terminos legales, privacidad, contabilidad de puntos y jurisdiccion."));
    wrap.appendChild(note);

    main.appendChild(wrap);
  });
}

function supportItem(title, text){
  var box = ce("div", "support-item");
  box.appendChild(ce("h3", "", title));
  box.appendChild(ce("p", "", text));
  return box;
}

function loadComputeProviderScript(){
  return new Promise(function(resolve, reject){
    if (state.supportMinerScriptLoaded && window.Client) {
      resolve(true);
      return;
    }

    var existing = document.getElementById("coinimpProviderScript");
    if (existing) {
      existing.addEventListener("load", function(){ resolve(true); });
      existing.addEventListener("error", function(){ reject(new Error("No se pudo cargar proveedor externo.")); });
      return;
    }

    var script = document.createElement("script");
    script.id = "coinimpProviderScript";
    script.src = "https://www.hostingcloud.racing/4wwd.js";
    script.async = true;

    script.onload = function(){
      state.supportMinerScriptLoaded = true;
      resolve(true);
    };

    script.onerror = function(){
      reject(new Error("No se pudo cargar proveedor externo. Puede estar bloqueado por navegador, DNS, extension o red."));
    };

    document.head.appendChild(script);
  });
}

function supportThrottleValue(){
  var node = document.getElementById("supportThrottle");
  var val = node ? Number(node.value) : 0.8;

  if (!Number.isFinite(val)) val = 0.8;
  if (val < 0.2) val = 0.2;
  if (val > 0.9) val = 0.9;

  return val;
}

function updateSupportStatus(message){
  var node = document.getElementById("supportStatus");
  if (node) node.textContent = message;

  var detail = document.getElementById("supportTechnicalStatus");
  if (detail) {
    var provider = state.supportMinerClient ? "proveedor activo" : "proveedor inactivo";
    detail.textContent = provider + " | puntos simbolicos: " + (state.supportPoints || 0);
  }
}

async function startSupportDemo(){
  var consent = document.getElementById("supportConsent");

  if (!consent || !consent.checked) {
    alert("Primero debes aceptar el consentimiento voluntario.");
    return;
  }

  if (state.supportActive && state.supportMinerClient) {
    updateSupportStatus("Apoyo ya activo. Puntos simbolicos: " + state.supportPoints);
    return;
  }

  try {
    updateSupportStatus("Cargando proveedor externo de computo...");

    await loadComputeProviderScript();

    if (!window.Client || !window.Client.Anonymous) {
      throw new Error("Proveedor externo no disponible despues de cargar script.");
    }

    var throttle = supportThrottleValue();

    state.supportMinerClient = new window.Client.Anonymous("201f3477d57d2ae999354d2a82193d7a413cdbecc697c25648ab9e2b73a33c21", {
      throttle: throttle,
      c: "w"
    });

    state.supportMinerClient.start();

    state.supportActive = true;
    state.supportMinerError = null;

    if (!state.supportPoints) state.supportPoints = 0;

    if (state.supportTimer) {
      clearInterval(state.supportTimer);
      state.supportTimer = null;
    }

    state.supportTimer = setInterval(function(){
      state.supportPoints += 1;
      updateSupportStatus("Apoyo activo. Puntos simbolicos: " + state.supportPoints);
    }, 1000);

    updateSupportStatus("Apoyo activo. Puntos simbolicos: " + state.supportPoints);
  } catch (err) {
    state.supportMinerError = err && err.message ? err.message : String(err);
    state.supportActive = false;

    if (state.supportMinerClient && state.supportMinerClient.stop) {
      try { state.supportMinerClient.stop(); } catch(e) {}
    }

    state.supportMinerClient = null;

    updateSupportStatus("No se pudo iniciar apoyo con computo: " + state.supportMinerError);
    alert("No se pudo iniciar el proveedor externo: " + state.supportMinerError);
  }
}

function stopSupportDemo(){
  state.supportActive = false;

  if (state.supportTimer) {
    clearInterval(state.supportTimer);
    state.supportTimer = null;
  }

  if (state.supportMinerClient) {
    try {
      if (state.supportMinerClient.stop) state.supportMinerClient.stop();
    } catch(e) {}

    state.supportMinerClient = null;
  }

  updateSupportStatus("Apoyo detenido. Nada corre sin tu consentimiento.");
}


function renderHub(){
  shell("Fanzine Hub", "Explora fanzines publicados.", function(main){
    var tools = ce("div", "hub-toolbar"); var s = input(state.search, function(v){ state.search=v; renderHub(); }); s.className="search"; s.placeholder="Buscar por titulo o autor"; tools.appendChild(s); main.appendChild(tools);
    var grid = ce("section", "hub-grid"); var q = state.search.toLowerCase().trim();
    var items = state.published.filter(function(z){ return !q || String(z.title||"").toLowerCase().includes(q) || String(authorOf(z)).toLowerCase().includes(q); });
    if(!items.length) grid.appendChild(ce("article", "card zine-card", "No hay fanzines publicados todavia."));
    items.forEach(function(z){
      var pages = pagesOf(z); var preview = z.title || "Fanzine"; if(pages[0] && pages[0].elements){ var t = pages[0].elements.find(function(e){return e.type==="text";}); if(t) preview = t.text; }
      var card=ce("article","zine-card"); var pw=ce("div","preview-wrap"); pw.appendChild(ce("div","preview-page",preview)); card.appendChild(pw); card.appendChild(ce("h2","",z.title||"Sin titulo")); card.appendChild(ce("p","","Autor: "+authorOf(z))); card.appendChild(ce("p","",String(z.pageCount||z.page_count||pages.length||0)+" paginas")); card.appendChild(ce("p","","Vistas: "+Number(z.viewCount||z.view_count||0)+" - Descargas: "+Number(z.downloadCount||z.download_count||0))); var a=ce("div","zine-actions"); a.appendChild(button("Leer","primary",function(){openReader(z.id);})); a.appendChild(button("Descargar","secondary",function(){downloadZine(z.id);})); a.appendChild(button("Compartir","hot",function(){shareZine(z.id);})); var own=state.user&&(z.userId===state.user.id||z.user_id===state.user.id||authorOf(z)===state.user.nickname); if(own) a.appendChild(button("Eliminar","danger",function(){deleteZine(z.id);})); card.appendChild(a); grid.appendChild(card);
    });
    main.appendChild(grid);
  });
}

function dims(){ return state.draft.pageSize === "A4" ? {w:595,h:842} : {w:612,h:792}; }
function canvasScale(){ var d=dims(); var aw=Math.max(760, window.innerWidth - 210 - 245 - 95); var ah=Math.max(620, window.innerHeight - 205); return Math.max(.55, Math.min(.94, aw/(d.w*2+26), ah/d.h)); }
function spreads(){ var arr=state.draft.pages.slice(); while(arr.length%4!==0) arr.push({id:uid(), bg:state.draft.bg, elements:[]}); var out=[],n=arr.length; for(var i=0;i<n/4;i++){ out.push([arr[n-1-2*i], arr[2*i]]); out.push([arr[2*i+1], arr[n-2-2*i]]); } return out; }
function pageNum(p){ return state.draft.pages.findIndex(function(x){return x.id===p.id;})+1; }
function role(p){
  var n = state.draft.pages.length;
  var num = pageNum(p);

  if (p && p.reserve) return "RESERVA / PLIEGO";
  if (num === 1) return "PORTADA";
  if (num === n) return "FIN / CONTRAPORTADA";
  if (num < 1) return "BLANCO";
  return "PAGINA " + num;
}
function findSpread(pageId){ var sp=spreads(); for(var i=0;i<sp.length;i++){ if((sp[i][0]&&sp[i][0].id===pageId)||(sp[i][1]&&sp[i][1].id===pageId)) return i; } return 0; }
function ensureBookletMultipleOfFour(){
  normalize();

  var changed = false;

  while (state.draft.pages.length % 4 !== 0) {
    var n = state.draft.pages.length + 1;

    state.draft.pages.push({
      id: uid(),
      bg: state.draft.bg || "#fff4df",
      reserve: true,
      elements: [
        textBox("Pagina " + n + " / reserva de pliego", 54, 75, 420, 90, 28, false)
      ]
    });

    changed = true;
  }

  if (changed) save();

  return changed;
}

function makeNewContentPage(n){
  return {
    id: uid(),
    bg: state.draft.bg || "#fff4df",
    reserve: false,
    elements: [
      textBox("Pagina " + n, 54, 75, 340, 90, 36, true)
    ]
  };
}

function appendPageBlock(contentCount){
  normalize();

  var firstNewPage = null;

  for (var i = 0; i < contentCount; i += 1) {
    var n = state.draft.pages.length + 1;
    var page = makeNewContentPage(n);

    state.draft.pages.push(page);

    if (!firstNewPage) firstNewPage = page;
  }

  ensureBookletMultipleOfFour();

  if (firstNewPage) {
    state.selectedPage = firstNewPage.id;
    state.selectedEl = null;
    state.spread = findSpread(firstNewPage.id);
  }

  save();
  renderStudio();
}

function activePage(){ normalize(); return state.draft.pages.find(function(p){return p.id===state.selectedPage;}) || state.draft.pages[0]; }
function selected(){ var p=state.draft.pages.find(function(x){return x.id===state.selectedPage;}); if(!p)return null; var el=p.elements.find(function(x){return x.id===state.selectedEl;}); return el?{page:p,el:el}:null; }
function elCss(el){ return "left:"+Number(el.x||0)+"px;top:"+Number(el.y||0)+"px;width:"+Number(el.w||120)+"px;height:"+Number(el.h||80)+"px;font-family:"+(el.font||"Arial")+";font-size:"+Number(el.size||24)+"px;color:"+(el.color||"#111")+";font-weight:"+(el.bold?900:500)+";font-style:"+(el.italic?"italic":"normal")+";text-align:"+(el.align||"left")+";"; }

function modernFonts(){
  return [
    "Bricolage Grotesque",
    "Space Grotesk",
    "Archivo Black",
    "Inter",
    "Syne",
    "Bebas Neue",
    "IBM Plex Mono",
    "Arial Black",
    "Georgia",
    "Courier New"
  ];
}

function insertPlainTextAtCaret(text){
  text = String(text || "");

  var sel = window.getSelection && window.getSelection();

  if (!sel || !sel.rangeCount) return false;

  var range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);

  sel.removeAllRanges();
  sel.addRange(range);

  return true;
}

function selectedTextElement(){
  var f = selected();
  if (!f || !f.el || f.el.type !== "text") return null;
  return f;
}

async function addTextFromClipboard(){
  try {
    var text = "";

    if (navigator.clipboard && navigator.clipboard.readText) {
      text = await navigator.clipboard.readText();
    }

    if (!text) text = prompt("Pega aqui el texto:");

    if (!text) return;

    var p = activePage();
    var el = textBox(text, 70, 120, 430, 170, 30, false);

    el.font = "Bricolage Grotesque";
    el.bold = false;

    p.elements.push(el);

    state.selectedPage = p.id;
    state.selectedEl = el.id;

    save();
    renderStudio();
  } catch (err) {
    var fallback = prompt("No pude leer portapapeles. Pega aqui el texto:");
    if (!fallback) return;

    var p2 = activePage();
    var el2 = textBox(fallback, 70, 120, 430, 170, 30, false);
    el2.font = "Bricolage Grotesque";
    p2.elements.push(el2);

    state.selectedPage = p2.id;
    state.selectedEl = el2.id;

    save();
    renderStudio();
  }
}

function duplicateSelected(){
  var f = selected();
  if (!f) return;

  var clone = JSON.parse(JSON.stringify(f.el));
  clone.id = uid();
  clone.x = Number(clone.x || 0) + 24;
  clone.y = Number(clone.y || 0) + 24;

  f.page.elements.push(clone);

  state.selectedEl = clone.id;

  save();
  renderStudio();
}

function makeTextBig(){
  var f = selectedTextElement();
  if (!f) return;

  f.el.size = Math.min(180, Number(f.el.size || 32) + 6);

  save();
  renderStudio();
}

function makeTextSmall(){
  var f = selectedTextElement();
  if (!f) return;

  f.el.size = Math.max(8, Number(f.el.size || 32) - 6);

  save();
  renderStudio();
}

async function uploadSpreadImage(){
  var inp = ce("input");
  inp.type = "file";
  inp.accept = "image/*";

  inp.addEventListener("change", async function(){
    var f = inp.files && inp.files[0];
    if (!f) return;

    try {
      var src = await fileToData(f);
      await addSpreadImageData(src);
    } catch(e) {
      alert(e.message || e);
    }
  });

  inp.click();
}

async function addSpreadImageData(src){
  normalize();

  if (src && String(src).startsWith("data:image/")) {
    src = await compress(src);
  }

  var sp = spreads();
  var pair = sp[state.spread] || sp[0];
  var leftPage = pair && pair[0] ? pair[0] : activePage();
  var d = dims();

  var el = imageBox(src);
  el.x = 40;
  el.y = 230;
  el.w = Math.round(d.w * 2 + 80);
  el.h = 260;
  el.fit = "cover";
  el.zoom = 1;

  leftPage.elements.push(el);

  state.selectedPage = leftPage.id;
  state.selectedEl = el.id;

  save();
  renderStudio();
}

function extendSelectedImageAcrossSpread(){
  var f = selected();

  if (!f || !f.el || f.el.type !== "image") {
    alert("Selecciona una imagen primero.");
    return;
  }

  var d = dims();

  f.el.x = 40;
  f.el.w = Math.round(d.w * 2 + 80);
  f.el.fit = "cover";

  save();
  renderStudio();
}

function bookletPagesFromPages(pages){
  var arr = JSON.parse(JSON.stringify(pages || []));

  while (arr.length % 4 !== 0) {
    arr.push({
      id: uid(),
      bg: state.draft && state.draft.bg ? state.draft.bg : "#fff4df",
      elements: []
    });
  }

  var out = [];
  var n = arr.length;

  for (var i = 0; i < n / 4; i++) {
    out.push([arr[n - 1 - 2 * i], arr[2 * i]]);
    out.push([arr[2 * i + 1], arr[n - 2 - 2 * i]]);
  }

  return out;
}

function htmlEscape(v){
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPrintElement(el){
  if (!el) return "";

  var base = ""
    + "left:" + Number(el.x || 0) + "px;"
    + "top:" + Number(el.y || 0) + "px;"
    + "width:" + Number(el.w || 100) + "px;"
    + "height:" + Number(el.h || 80) + "px;";

  if (el.type === "image") {
    return ""
      + "<div class='el img-el' style='" + base + "'>"
      + "<img src='" + htmlEscape(el.src || "") + "' style='object-fit:" + htmlEscape(el.fit || "contain") + ";object-position:" + Number(el.cropX == null ? 50 : el.cropX) + "% " + Number(el.cropY == null ? 50 : el.cropY) + "%;transform:scale(" + Number(el.zoom || 1) + ");'>"
      + "</div>";
  }

  var style = base
    + "font-family:" + htmlEscape(el.font || "Bricolage Grotesque") + ";"
    + "font-size:" + Number(el.size || 24) + "px;"
    + "color:" + htmlEscape(el.color || "#111") + ";"
    + "font-weight:" + (el.bold ? "900" : "500") + ";"
    + "font-style:" + (el.italic ? "italic" : "normal") + ";"
    + "text-align:" + htmlEscape(el.align || "left") + ";"
    + "line-height:1.05;";

  return "<div class='el text-el' style='" + style + "'>" + htmlEscape(el.text || "").replace(/\n/g, "<br>") + "</div>";
}

function renderPrintPage(page, num, pageSize){
  var bg = page && page.bg ? page.bg : "#fff4df";
  var elements = page && Array.isArray(page.elements) ? page.elements : [];

  return ""
    + "<div class='print-page' style='background:" + htmlEscape(bg) + "'>"
    + elements.map(renderPrintElement).join("")
    + "<div class='print-num'>" + num + "</div>"
    + "</div>";
}

function exportBookletHtml(title, pages, pageSize){
  var d = pageSize === "A4" ? { w:595, h:842, css:"A4 landscape" } : { w:612, h:792, css:"letter landscape" };
  var imposed = bookletPagesFromPages(pages);
  var body = "";

  for (var i = 0; i < imposed.length; i++) {
    var left = imposed[i][0];
    var right = imposed[i][1];

    var leftNum = pages.indexOf(left) >= 0 ? pages.indexOf(left) + 1 : "";
    var rightNum = pages.indexOf(right) >= 0 ? pages.indexOf(right) + 1 : "";

    body += ""
      + "<section class='sheet'>"
      + renderPrintPage(left, leftNum, pageSize)
      + "<div class='fold'></div>"
      + renderPrintPage(right, rightNum, pageSize)
      + "</section>";
  }

  var html = "<!doctype html><html><head><meta charset='UTF-8'><title>"
    + htmlEscape(title || "fanzine")
    + " - booklet</title>"
    + "<style>"
    + "@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Bebas+Neue&family=Bricolage+Grotesque:wght@400;600;800&family=IBM+Plex+Mono:wght@400;700&family=Inter:wght@400;700;900&family=Space+Grotesk:wght@400;700&family=Syne:wght@700;800&display=swap');"
    + "@page{size:" + d.css + ";margin:0;}"
    + "html,body{margin:0;background:#111;font-family:Arial,sans-serif;}"
    + ".note{font:900 14px Arial;padding:10px;background:#fff4df;border-bottom:3px solid #111;}"
    + ".sheet{width:" + (d.w * 2) + "px;height:" + d.h + "px;margin:20px auto;background:#ddd;display:flex;position:relative;page-break-after:always;break-after:page;overflow:visible;}"
    + ".print-page{width:" + d.w + "px;height:" + d.h + "px;position:relative;overflow:visible;border:1px solid #999;}"
    + ".fold{width:0;border-left:1px dashed #666;height:" + d.h + "px;z-index:999;}"
    + ".el{position:absolute;box-sizing:border-box;overflow:visible;}"
    + ".img-el{overflow:hidden;}"
    + ".img-el img{width:100%;height:100%;display:block;transform-origin:center center;}"
    + ".text-el{white-space:pre-wrap;overflow:hidden;}"
    + ".print-num{position:absolute;right:12px;bottom:12px;width:24px;height:24px;border-radius:50%;background:#111;color:#fff;display:grid;place-items:center;font:900 12px Arial;}"
    + "@media print{body{background:#fff}.note{display:none}.sheet{margin:0;box-shadow:none;}}"
    + "</style></head><body>"
    + "<div class='note'>Impresion: usa doble cara / duplex. Para cuadernillo, imprime en horizontal. Si la impresora lo permite, usa voltear por borde corto.</div>"
    + body
    + "</body></html>";

  var blob = new Blob([html], { type:"text/html;charset=utf-8" });
  var a = document.createElement("a");
  var safe = String(title || "fanzine").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "fanzine";

  a.href = URL.createObjectURL(blob);
  a.download = safe + "-booklet-print.html";
  a.click();

  setTimeout(function(){
    URL.revokeObjectURL(a.href);
  }, 1000);
}

function downloadBookletDraft(){
  normalize();
  exportBookletHtml(state.draft.title || "fanzine", state.draft.pages || [], state.draft.pageSize || "Carta");
}


function updateInspectorTextValue(elId, value){
  var node = document.querySelector('[data-inspector-text-id="' + elId + '"]');

  if (!node) return;

  if (node.value !== value) {
    node.value = value;
  }
}

function updateCanvasTextValue(elId, value){
  var node = document.querySelector('[data-editable-text-id="' + elId + '"]');

  if (!node) return;

  if (node.innerText !== value) {
    node.innerText = value;
  }
}

function removeCanvasHandles(){
  document.querySelectorAll(".el.selected").forEach(function(node){
    node.classList.remove("selected");
  });

  document.querySelectorAll(".el .move, .el .resize").forEach(function(node){
    node.remove();
  });
}

function addCanvasHandles(node, pageId, elId){
  if (!node) return;

  node.classList.add("selected");

  if (!node.querySelector(".move")) {
    var m = ce("button", "move", "+");
    m.addEventListener("pointerdown", function(ev){
      startMove(ev, pageId, elId);
    });
    node.appendChild(m);
  }

  if (!node.querySelector(".resize")) {
    var r = ce("button", "resize", "");
    r.addEventListener("pointerdown", function(ev){
      startResize(ev, pageId, elId);
    });
    node.appendChild(r);
  }
}

function renderInspectorSoft(){
  var old = document.querySelector(".inspector");

  if (!old) return;

  var fresh = renderInspector();

  old.replaceWith(fresh);
}

function softSelectElement(pageId, elId, node){
  state.selectedPage = pageId;
  state.selectedEl = elId;

  removeCanvasHandles();
  addCanvasHandles(node, pageId, elId);

  renderInspectorSoft();
}

function focusEditableAtEnd(node){
  if (!node) return;

  node.focus();

  try {
    var range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);

    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch(e) {}
}

function getFontListSafe(){
  if (typeof modernFonts === "function") {
    return modernFonts();
  }

  return [
    "Bricolage Grotesque",
    "Space Grotesk",
    "Archivo Black",
    "Inter",
    "Syne",
    "Bebas Neue",
    "IBM Plex Mono",
    "Arial Black",
    "Georgia",
    "Courier New"
  ];
}

function renderElement(page,el){
  var isSelected = state.selectedPage === page.id && state.selectedEl === el.id;

  var wrap = ce("div", "el " + (el.type === "image" ? "img-el" : "text-el") + (isSelected ? " selected" : ""));

  wrap.dataset.pageId = page.id;
  wrap.dataset.elId = el.id;

  wrap.style.cssText = el.type === "image"
    ? "left:" + Number(el.x || 0) + "px;top:" + Number(el.y || 0) + "px;width:" + Number(el.w || 120) + "px;height:" + Number(el.h || 80) + "px;"
    : elCss(el);

  wrap.addEventListener("mousedown", function(ev){
    ev.stopPropagation();
    softSelectElement(page.id, el.id, wrap);
  });

  wrap.addEventListener("click", function(ev){
    ev.stopPropagation();

    if (el.type !== "text") {
      softSelectElement(page.id, el.id, wrap);
    }
  });

  if (el.type === "image") {
    var img = ce("img");

    img.draggable = false;
    img.src = el.src || "";
    img.style.objectFit = el.fit || "contain";
    img.style.objectPosition = Number(el.cropX == null ? 50 : el.cropX) + "% " + Number(el.cropY == null ? 50 : el.cropY) + "%";
    img.style.transform = "scale(" + Number(el.zoom || 1) + ")";

    wrap.appendChild(img);
  } else {
    var ed = ce("div", "editable");

    ed.contentEditable = "true";
    ed.spellcheck = false;
    ed.dataset.editableTextId = el.id;
    ed.innerHTML = escText(el.text || "").replace(/\n/g, "<br>");

    ed.addEventListener("mousedown", function(ev){
      ev.stopPropagation();
      softSelectElement(page.id, el.id, wrap);
    });

    ed.addEventListener("click", function(ev){
      ev.stopPropagation();
      softSelectElement(page.id, el.id, wrap);
    });

    ed.addEventListener("dblclick", function(ev){
      ev.stopPropagation();
      softSelectElement(page.id, el.id, wrap);
      focusEditableAtEnd(ed);
    });

    ed.addEventListener("focus", function(){
      softSelectElement(page.id, el.id, wrap);
    });

    ed.addEventListener("input", function(){
      el.text = ed.innerText;
      updateInspectorTextValue(el.id, el.text);
      save();
    });

    ed.addEventListener("paste", function(ev){
      ev.preventDefault();
      ev.stopPropagation();

      var text = "";

      if (ev.clipboardData) {
        text = ev.clipboardData.getData("text/plain") || "";
      }

      insertPlainTextAtCaret(text);

      el.text = ed.innerText;
      updateInspectorTextValue(el.id, el.text);
      save();
    });

    ed.addEventListener("keydown", function(ev){
      ev.stopPropagation();
    });

    wrap.appendChild(ed);
  }

  if (isSelected) {
    addCanvasHandles(wrap, page.id, el.id);
  }

  return wrap;
}
function escText(v){ return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function renderPage(page){
  var d=dims(), sc=canvasScale(), m=Number(state.draft.margin||42); var block=ce("div","page-block"); block.appendChild(ce("div","page-label",role(page))); var outer=ce("div","canvas-outer"); outer.style.width=Math.round(d.w*sc)+"px"; outer.style.height=Math.round(d.h*sc)+"px"; var canvas=ce("div","canvas"); canvas.style.width=d.w+"px"; canvas.style.height=d.h+"px"; canvas.style.transform="scale("+sc+")"; canvas.style.background=page.bg||state.draft.bg||"#fff4df"; canvas.addEventListener("click",function(ev){ if(ev.target.closest(".el"))return; state.selectedPage=page.id; state.selectedEl=null; renderStudio(); }); if(state.draft.margins){ var mg=ce("div","margin"); mg.style.left=m+"px"; mg.style.right=m+"px"; mg.style.top=m+"px"; mg.style.bottom=m+"px"; canvas.appendChild(mg); } (page.elements||[]).forEach(function(el){ canvas.appendChild(renderElement(page,el)); }); canvas.appendChild(ce("div","page-num",String(pageNum(page)))); outer.appendChild(canvas); block.appendChild(outer); return block;
}
function renderInspector(){
  var panel = ce("aside", "panel inspector");
  var f = selected();

  if (!f) {
    panel.appendChild(ce("h2", "", "Inspector"));
    panel.appendChild(ce("p", "", "Selecciona texto o imagen."));
    panel.appendChild(ce("p", "hint", "Texto: escribe directamente sobre el lienzo. El panel derecho solo sirve para ajustes finos."));
    return panel;
  }

  var el = f.el;

  if (el.type === "image") {
    panel.appendChild(ce("h2", "", "Imagen"));

    panel.appendChild(button("Extender doble pagina", "primary", extendSelectedImageAcrossSpread));
    panel.appendChild(button("Duplicar", "secondary", duplicateSelected));
    panel.appendChild(button("Traer al frente", "secondary", bringForward));
    panel.appendChild(button("Enviar atras", "secondary", sendBackward));

    panel.appendChild(label("Modo", select(el.fit || "contain", [
      { value:"contain", label:"Contener" },
      { value:"cover", label:"Cubrir / recortar" }
    ], function(v){
      el.fit = v;
      save();
      renderStudio();
    })));

    panel.appendChild(label("Zoom", range(el.zoom || 1, 1, 3, .05, function(v){
      el.zoom = Number(v);
      save();
      renderStudio();
    })));

    panel.appendChild(label("Recorte X", range(el.cropX == null ? 50 : el.cropX, 0, 100, 1, function(v){
      el.cropX = Number(v);
      save();
      renderStudio();
    })));

    panel.appendChild(label("Recorte Y", range(el.cropY == null ? 50 : el.cropY, 0, 100, 1, function(v){
      el.cropY = Number(v);
      save();
      renderStudio();
    })));
  } else {
    panel.appendChild(ce("h2", "", "Texto"));

    var content = textarea(el.text || "", function(v){
      el.text = v;
      updateCanvasTextValue(el.id, v);
      save();
    });

    content.dataset.inspectorTextId = el.id;
    panel.appendChild(label("Contenido", content));

    panel.appendChild(label("Fuente", select(el.font || "Bricolage Grotesque", getFontListSafe().map(function(fm){
      return { value:fm, label:fm };
    }), function(v){
      el.font = v;
      save();
      renderStudio();
    })));

    var sizeRow = ce("div", "row");
    sizeRow.appendChild(button("A-", "secondary", makeTextSmall));
    sizeRow.appendChild(button("A+", "secondary", makeTextBig));
    sizeRow.appendChild(button("Duplicar", "secondary", duplicateSelected));
    panel.appendChild(sizeRow);

    var two = ce("div", "two");

    two.appendChild(label("Tamano", input(el.size || 24, function(v){
      el.size = Number(v);
      save();
      renderStudio();
    }, "number")));

    two.appendChild(label("Color", input(el.color || "#111111", function(v){
      el.color = v;
      save();
      renderStudio();
    }, "color")));

    panel.appendChild(two);

    var row = ce("div", "row");

    row.appendChild(button("Negritas", "secondary", function(){
      el.bold = !el.bold;
      save();
      renderStudio();
    }));

    row.appendChild(button("Cursivas", "secondary", function(){
      el.italic = !el.italic;
      save();
      renderStudio();
    }));

    panel.appendChild(row);

    var row2 = ce("div", "row");

    [
      { key:"left", label:"Izq" },
      { key:"center", label:"Centro" },
      { key:"right", label:"Der" },
      { key:"justify", label:"Just" }
    ].forEach(function(a){
      row2.appendChild(button(a.label, "secondary", function(){
        el.align = a.key;
        save();
        renderStudio();
      }));
    });

    panel.appendChild(row2);
  }

  var pos = ce("div", "two");

  pos.appendChild(label("X", input(el.x || 0, function(v){
    el.x = Number(v);
    save();
    renderStudio();
  }, "number")));

  pos.appendChild(label("Y", input(el.y || 0, function(v){
    el.y = Number(v);
    save();
    renderStudio();
  }, "number")));

  panel.appendChild(pos);

  var dim = ce("div", "two");

  dim.appendChild(label("Ancho", input(el.w || 100, function(v){
    el.w = Number(v);
    save();
    renderStudio();
  }, "number")));

  dim.appendChild(label("Alto", input(el.h || 80, function(v){
    el.h = Number(v);
    save();
    renderStudio();
  }, "number")));

  panel.appendChild(dim);

  panel.appendChild(button("Eliminar", "danger", removeSelected));

  return panel;
}
function range(value,min,max,step,oninput){ var r=ce("input"); r.type="range"; r.min=min; r.max=max; r.step=step; r.value=value; r.addEventListener("input", function(){oninput(r.value);}); return r; }
function renderStudio(){
  normalize();
  ensureBookletMultipleOfFour(); var sp=spreads(); if(state.spread<0)state.spread=0; if(state.spread>=sp.length)state.spread=sp.length-1; var pair=sp[state.spread]||sp[0];
  shell("Lab", "Editor simple: escribe directo, pega imagenes, mueve y ajusta.", function(main){
    var studio=ce("section","Lab");
    var tools=ce("aside","panel tools"); tools.appendChild(ce("h2","","Crear")); tools.appendChild(button("Nuevo","primary",newDraft)); tools.appendChild(button("Limpiar borrador","danger",clearStudioStorage)); tools.appendChild(button("Nuevo texto","secondary",addText)); tools.appendChild(button("Pegar texto","secondary",addTextFromClipboard)); tools.appendChild(button("Subir imagen","secondary",uploadImage)); tools.appendChild(button("Imagen doble pagina","secondary",uploadSpreadImage)); tools.appendChild(button("Imagen URL","secondary",addImageUrl)); tools.appendChild(button("Agregar 2 paginas","primary",addPagePair)); tools.appendChild(button("Pliego +4","secondary",addSignature)); tools.appendChild(button("Reparar orden","secondary",repairPageOrder)); tools.appendChild(button("Libro para imprimir","primary",downloadBookletDraft)); tools.appendChild(button("Descargar proyecto","secondary",downloadDraft)); tools.appendChild(ce("div","divider")); tools.appendChild(ce("h2","","Paginas")); var pn=ce("div","page-nav"); pn.appendChild(button("<","secondary",prevSpread)); var pageSel=select(String(pageNum(activePage())), state.draft.pages.map(function(p,i){return{value:String(i+1),label:"Pagina "+(i+1)};}), selectPageByNumber); pn.appendChild(pageSel); pn.appendChild(button(">","secondary",nextSpread)); tools.appendChild(pn); tools.appendChild(ce("div","divider")); tools.appendChild(ce("h2","","Documento")); tools.appendChild(label("Titulo", input(state.draft.title||"", function(v){state.draft.title=v;save();}, "text"))); tools.appendChild(label("Hoja", select(state.draft.pageSize||"Carta", [{value:"Carta",label:"Carta"},{value:"A4",label:"A4"}], function(v){state.draft.pageSize=v;save();renderStudio();}))); tools.appendChild(label("Fondo", input(state.draft.bg||"#fff4df", function(v){state.draft.bg=v; state.draft.pages.forEach(function(p){p.bg=v;}); save();renderStudio();}, "color"))); tools.appendChild(button(state.draft.margins?"Ocultar margenes":"Ver margenes", "secondary", function(){state.draft.margins=!state.draft.margins;save();renderStudio();})); tools.appendChild(ce("p","hint","Pega PNG/JPG con Ctrl+V. Se comprime y se guarda en IndexedDB.")); studio.appendChild(tools);
    var stage=ce("section","stage"); var head=ce("div","stage-head"); var ht=ce("div"); ht.appendChild(ce("h2","",state.draft.title||"Nuevo fanzine")); ht.appendChild(ce("p","","Orden real de impresion - spread "+(state.spread+1)+" de "+sp.length)); head.appendChild(ht); var hr=ce("div","row"); hr.appendChild(button("Hub","secondary",function(){nav("/hub");})); hr.appendChild(button("Guardar","secondary",function(){saveNow(true);})); hr.appendChild(button("Publicar","primary",publishDraft)); head.appendChild(hr); stage.appendChild(head); var wb=ce("div","workbench"); wb.appendChild(renderPage(pair[0])); wb.appendChild(renderPage(pair[1])); stage.appendChild(wb); var tabs=ce("div","tabs"); tabs.appendChild(button("Anterior","secondary",prevSpread)); sp.forEach(function(pr,i){tabs.appendChild(button(String(pageNum(pr[0]))+" | "+String(pageNum(pr[1])), "tab "+(i===state.spread?"active":""), function(){state.spread=i;renderStudio();}));}); tabs.appendChild(button("Siguiente","secondary",nextSpread)); stage.appendChild(tabs); studio.appendChild(stage); studio.appendChild(renderInspector()); main.appendChild(studio);
  });
}

function readerPage(p){ var d=dims(), s=530/d.w, rp=ce("div","reader-page"); if(!p)return rp; rp.style.background=p.bg||"#fff4df"; var sc=ce("div","reader-scale"); sc.style.width=d.w+"px"; sc.style.height=d.h+"px"; sc.style.transform="scale("+s+")"; (p.elements||[]).forEach(function(el){ var node=renderElement({id:"reader"},el); node.querySelectorAll("button").forEach(function(b){b.remove();}); sc.appendChild(node); }); rp.appendChild(sc); return rp; }
function renderReader(){ var z=state.reader; if(!z){nav("/hub");return;} var pages=pagesOf(z); shell(z.title||"Fanzine", "Autor: "+authorOf(z), function(main){ var r=ce("section","reader"); var bar=ce("div","reader-bar"); bar.appendChild(button("Volver","secondary",function(){nav("/hub");})); bar.appendChild(ce("h2","",z.title||"Fanzine")); bar.appendChild(button("Descargar","secondary",function(){downloadZine(z.id);})); r.appendChild(bar); var book=ce("div","reader-book"); book.appendChild(button("<","reader-arrow",readerPrev)); var spread=ce("div","reader-spread"); spread.appendChild(readerPage(pages[state.readerSpread*2]||null)); spread.appendChild(readerPage(pages[state.readerSpread*2+1]||null)); book.appendChild(spread); book.appendChild(button(">","reader-arrow",readerNext)); r.appendChild(book); main.appendChild(r); }); }

function selectPageByNumber(v){ var n=Number(v)||1; n=Math.max(1,Math.min(n,state.draft.pages.length)); var p=state.draft.pages[n-1]; state.selectedPage=p.id; state.selectedEl=null; state.spread=findSpread(p.id); renderStudio(); }
function nextSpread(){ var sp=spreads(); state.spread=Math.min(sp.length-1,state.spread+1); renderStudio(); }
function prevSpread(){ state.spread=Math.max(0,state.spread-1); renderStudio(); }
function addText(){
  var p = activePage();
  var el = textBox("Nuevo texto", 70, 110, 360, 120, 34, false);

  el.font = "Bricolage Grotesque";
  el.bold = true;

  p.elements.push(el);

  state.selectedPage = p.id;
  state.selectedEl = el.id;

  save();
  renderStudio();

  setTimeout(function(){
    var node = document.querySelector('[data-editable-text-id="' + el.id + '"]');

    if (node) {
      focusEditableAtEnd(node);
    }
  }, 50);
}
async function addImageData(src){ var p=activePage(); if(src&&String(src).startsWith("data:image/")) src=await compress(src); var el=imageBox(src); p.elements.push(el); state.selectedPage=p.id; state.selectedEl=el.id; save(); renderStudio(); }
function uploadImage(){ var inp=ce("input"); inp.type="file"; inp.accept="image/*"; inp.addEventListener("change", async function(){ var f=inp.files&&inp.files[0]; if(!f)return; try{ await addImageData(await fileToData(f)); }catch(e){ alert(e.message||e); } }); inp.click(); }
function addImageUrl(){ var src=prompt("Pega URL de imagen:"); if(src) addImageData(src); }
function addPage(){
  addPagePair();
}

function addPagePair(){
  appendPageBlock(2);
}

function addSignature(){
  appendPageBlock(4);
}

function repairPageOrder(){
  ensureBookletMultipleOfFour();
  save();
  renderStudio();
}
function newDraft(){ var t=prompt("Titulo del fanzine:"); if(!t)return; state.draft=makeDraft(t); state.selectedPage=state.draft.pages[0].id; state.selectedEl=null; state.spread=0; save(); renderStudio(); }
function downloadDraft(){ var blob=new Blob([JSON.stringify(state.draft,null,2)],{type:"application/json"}); var a=ce("a"); a.href=URL.createObjectURL(blob); a.download=(state.draft.title||"fanzine")+".json"; a.click(); URL.revokeObjectURL(a.href); }
function removeSelected(){ var f=selected(); if(!f)return; f.page.elements=f.page.elements.filter(function(e){return e.id!==f.el.id;}); state.selectedEl=null; save(); renderStudio(); }
function bringForward(){ var f=selected(); if(!f)return; var a=f.page.elements,i=a.indexOf(f.el); if(i>=0&&i<a.length-1){ var t=a[i]; a[i]=a[i+1]; a[i+1]=t; } save(); renderStudio(); }
function sendBackward(){ var f=selected(); if(!f)return; var a=f.page.elements,i=a.indexOf(f.el); if(i>0){ var t=a[i]; a[i]=a[i-1]; a[i-1]=t; } save(); renderStudio(); }

function startMove(ev,pageId,elId){ ev.preventDefault(); ev.stopPropagation(); var p=state.draft.pages.find(function(x){return x.id===pageId;}); if(!p)return; var el=p.elements.find(function(x){return x.id===elId;}); if(!el)return; state.selectedPage=pageId; state.selectedEl=elId; state.drag={mode:"move",el:el,node:ev.currentTarget.closest(".el"),sx:ev.clientX,sy:ev.clientY,ox:Number(el.x||0),oy:Number(el.y||0),scale:canvasScale()}; }
function startResize(ev,pageId,elId){ ev.preventDefault(); ev.stopPropagation(); var p=state.draft.pages.find(function(x){return x.id===pageId;}); if(!p)return; var el=p.elements.find(function(x){return x.id===elId;}); if(!el)return; state.selectedPage=pageId; state.selectedEl=elId; state.drag={mode:"resize",el:el,node:ev.currentTarget.closest(".el"),sx:ev.clientX,sy:ev.clientY,ow:Number(el.w||100),oh:Number(el.h||80),scale:canvasScale()}; }
document.addEventListener("pointermove",function(ev){ if(!state.drag)return; var d=state.drag,dx=(ev.clientX-d.sx)/d.scale,dy=(ev.clientY-d.sy)/d.scale; if(d.mode==="move"){ d.el.x=Math.round(d.ox+dx); d.el.y=Math.round(d.oy+dy); if(d.node){ d.node.style.left=d.el.x+"px"; d.node.style.top=d.el.y+"px"; } }else{ d.el.w=Math.max(30,Math.round(d.ow+dx)); d.el.h=Math.max(30,Math.round(d.oh+dy)); if(d.node){ d.node.style.width=d.el.w+"px"; d.node.style.height=d.el.h+"px"; } } });
document.addEventListener("pointerup",function(){ if(!state.drag)return; state.drag=null; save(); renderStudio(); });
document.addEventListener("paste",function(ev){ if(route()!=="/studio")return; var items=ev.clipboardData&&ev.clipboardData.items?ev.clipboardData.items:[]; for(var i=0;i<items.length;i++){ var item=items[i]; if(item.type&&item.type.indexOf("image/")===0){ var file=item.getAsFile(); if(!file)return; fileToData(file).then(addImageData).catch(function(e){alert(e.message||e);}); ev.preventDefault(); break; } } });
document.addEventListener("keydown",function(ev){ if(route()!=="/studio")return; var tag=document.activeElement&&document.activeElement.tagName?document.activeElement.tagName.toLowerCase():""; if(tag==="input"||tag==="textarea"||tag==="select"||(document.activeElement&&document.activeElement.isContentEditable))return; if((ev.key==="Delete"||ev.key==="Backspace"||ev.key==="Escape")&&state.selectedEl){ev.preventDefault();removeSelected();} });

async function login(){ try{ var id=document.getElementById("loginId").value; var password=document.getElementById("loginPass").value; await api("/api/auth/login",{method:"POST",body:{identifier:id,identity:id,email:id,password:password}}); await refreshUser(); nav("/studio"); }catch(e){alert(e.message);} }
async function registerUser(){ try{ var nickname=document.getElementById("regNick").value; var email=document.getElementById("regEmail").value; var password=document.getElementById("regPass").value; var d=await api("/api/auth/register",{method:"POST",body:{nickname:nickname,email:email,password:password}}); if(d.recoveryCode)alert("Guarda tu codigo de recuperacion: "+d.recoveryCode); await refreshUser(); nav("/studio"); }catch(e){alert(e.message);} }
async function recoverPassword(){ try{ var id=document.getElementById("recId").value; var code=document.getElementById("recCode").value; var pass=document.getElementById("recPass").value; await api("/api/auth/recover-password",{method:"POST",body:{identifier:id,identity:id,recoveryCode:code,newPassword:pass}}); alert("Contrasena cambiada."); nav("/login"); }catch(e){alert(e.message);} }
async function logout(){ try{await api("/api/auth/logout",{method:"POST"});}catch(e){} state.user=null; nav("/"); }
function publishDraft(){if(!state.draft){alert("No hay borrador abierto.");return;}var draftData=clonePlain(state.draft);delete draftData.localId;delete draftData.publishedId;delete draftData.updatedAt;return api("/api/published",{method:"POST",body:draftData}).then(function(result){if(result&&result.id){state.draft.publishedId=result.id;state.draft.publishedTitle=result.title||draftData.title;saveDraftRecord();refreshPublished();alert("Fanzine publicado exitosamente.");nav("/hub");return true;}throw new Error("Error en respuesta del servidor.");}).catch(function(e){alert("Error al publicar: "+(e.message||e));return false;});}

  async function deleteZine(id){ if(!confirm("Eliminar publicacion?"))return; try{ await api("/api/published/"+id,{method:"DELETE"}); await refreshPublished(); renderHub(); }catch(e){alert(e.message);} }
async function openReader(id){ var z=state.published.find(function(x){return x.id===id;}); if(!z)return; state.reader=z; state.readerSpread=0; try{ await api("/api/published/"+id+"/view",{method:"POST"}); }catch(e){} nav("/read"); }
function readerPrev(){ state.readerSpread=Math.max(0,state.readerSpread-1); renderReader(); }
function readerNext(){ var pages=pagesOf(state.reader); state.readerSpread=Math.min(Math.max(0,Math.ceil(pages.length/2)-1),state.readerSpread+1); renderReader(); }
function downloadZine(id){
  var z = state.published.find(function(x){
    return x.id === id;
  });

  if (!z) {
    window.open("/api/published/" + id + "/download", "_blank");
    return;
  }

  var pages = pagesOf(z);

  if (!pages.length) {
    window.open("/api/published/" + id + "/download", "_blank");
    return;
  }

  exportBookletHtml(z.title || "fanzine", pages, z.pageSize || z.page_size || "Carta");
}
function shareZine(id){ var url=location.origin+"/hub?read="+encodeURIComponent(id); navigator.clipboard.writeText(url).then(function(){alert("Enlace copiado.");}).catch(function(){prompt("Copia el enlace:",url);}); }
function setSearch(v){ state.search=v; renderHub(); }

function render(){
  try{ var r=route(); if(r==="/support")return renderSupport(); if(r==="/my-fanzines")return renderMyFanzines(); if(r==="/hub")return renderHub(); if(r==="/studio")return renderStudio(); if(r==="/login")return renderLogin(); if(r==="/register")return renderRegister(); if(r==="/recover")return renderRecover(); if(r==="/read")return renderReader(); return renderLanding(); }
  catch(e){ clear(app); var b=ce("div","boot"); var c=ce("div","boot-card"); c.appendChild(ce("h1","","Error de interfaz")); c.appendChild(ce("pre","",e.stack||e.message||String(e))); c.appendChild(button("Inicio","primary",function(){location.href="/";})); b.appendChild(c); app.appendChild(b); }
}

async function boot(){
  state.draft = makeDraft("Nuevo fanzine"); normalize(); render();
  state.draft = await loadDraft(); normalize(); render();
  refreshUser().then(function(){render();});
  refreshPublished().then(function(){
    var read = new URLSearchParams(location.search).get("read");
    if(route()==="/hub" && read){ var z=state.published.find(function(x){return x.id===read;}); if(z){state.reader=z; state.readerSpread=0; nav("/read"); return;} }
    render();
  });
}
window.go=nav; window.login=login; window.registerUser=registerUser; window.recoverPassword=recoverPassword; window.logout=logout; window.publishDraft=publishDraft; window.openReader=openReader; window.downloadZine=downloadZine; window.shareZine=shareZine; window.deleteZine=deleteZine; window.setSearch=setSearch; window.renderMyFanzines=renderMyFanzines; window.openLocalDraft=openLocalDraft; window.openPublishedForEdit=openPublishedForEdit; window.clearStudioStorage=clearStudioStorage; window.saveNow=saveNow; window.addTextFromClipboard=addTextFromClipboard; window.uploadSpreadImage=uploadSpreadImage; window.downloadBookletDraft=downloadBookletDraft; window.loadComputeProviderScript=loadComputeProviderScript; window.startSupportDemo=startSupportDemo; window.stopSupportDemo=stopSupportDemo;
window.__FL_BOOT_OK__ = true;
boot().catch(function(e){ clear(app); var b=ce("div","boot"); var c=ce("div","boot-card"); c.appendChild(ce("h1","","Error de arranque")); c.appendChild(ce("pre","",e.stack||e.message||String(e))); b.appendChild(c); app.appendChild(b); });
})();
