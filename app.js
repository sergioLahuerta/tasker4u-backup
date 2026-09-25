// // NOTIS PUSH //
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('Service Worker registrado con éxito:', reg.scope))
            .catch(err => console.error('Error al registrar el Service Worker:', err));
    });
}

// Pedir permisos de notificación nativos al iniciar
if ("Notification" in window && Notification.permission !== "granted") {
    Notification.requestPermission();
}

let folders = JSON.parse(localStorage.getItem('tasker_data')) || [
    {
        id: 1,
        name: 'Personal',
        icon: '📁',
        subfolders: [],
        tasks: [
            { id: 101, text: 'Hacer compra semanal', done: false, dueDate: null, createdAt: new Date().toISOString(), completedAt: null },
            { id: 102, text: 'Entrenamiento piscina', done: true, dueDate: null, createdAt: new Date().toISOString(), completedAt: new Date().toISOString() }
        ]
    },
    {
        id: 2,
        name: 'Proyectos & Código',
        icon: '📁',
        subfolders: [],
        tasks: [
            { id: 201, text: 'Diseñar interfaz en Tailwind', done: false, dueDate: null, createdAt: new Date().toISOString(), completedAt: null }
        ]
    }
];

let navigationStack = [];
let currentFilter = 'all';
let currentSort = 'recent'; 
let currentCreationMode = 'folder';
let expandedTasks = new Set();
let clipboard = null;

let isMultiSelectMode = false;
let selectedIds = new Set();
let selectedFolderIds = new Set();
let activeTaskIdForDate = null;

let ghConfig = JSON.parse(localStorage.getItem('tasker_gh_config')) || {
    user: '',
    repo: '',
    token: ''
};

const headerEl = document.getElementById('header');
const mainEl = document.getElementById('main-content');
const formEl = document.getElementById('action-form');
const inputEl = document.getElementById('action-input');
const selectorContainer = document.getElementById('selector-container');
const customSelectBtn = document.getElementById('custom-select-btn');
const customDropdownMenu = document.getElementById('custom-dropdown-menu');
const customSelectText = document.getElementById('custom-select-text');
const dropdownOptionItem = document.getElementById('dropdown-option-item');
const actionNavbar = document.getElementById('action-navbar');
const dateModal = document.getElementById('date-modal');
const modalDatetimeInput = document.getElementById('modal-datetime-input');

if ("Notification" in window && Notification.permission !== "granted") {
    Notification.requestPermission();
}

async function subscribeUserToPush() {
    const registration = await navigator.serviceWorker.ready;
    
    // Necesitas generar unas VAPID keys públicas/privadas gratuitas para esto
    const publicVapidKey = 'TU_CLAVE_PUBLICA_VAPID'; 
    
    const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicVapidKey
    });

    console.log('Usuario suscrito:', JSON.stringify(subscription));
    // Aquí enviarías esta 'subscription' a tu backend o base de datos guardándola junto al usuario/tarea
}


customSelectBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    customDropdownMenu.classList.toggle('hidden');
});

document.addEventListener('click', () => {
    customDropdownMenu.classList.add('hidden');
    closeAllContextMenus();
    const sortMenu = document.getElementById('sort-dropdown-menu');
    if (sortMenu) sortMenu.classList.add('hidden');
});

function toggleCreationMode() {
    currentCreationMode = currentCreationMode === 'folder' ? 'task' : 'folder';
    updateSelectorUI();
    customDropdownMenu.classList.add('hidden');

    const folder = getCurrentFolder();
    if (folder) {
        inputEl.placeholder = currentCreationMode === 'folder' ? 'Nombre de la nueva subcarpeta...' : `Añadir tarea en ${folder.name}...`;
    }
}

function updateSelectorUI() {
    if (currentCreationMode === 'folder') {
        customSelectText.textContent = '📁 Subcarpeta';
        dropdownOptionItem.innerHTML = '📝 Tarea';
    } else {
        customSelectText.textContent = '📝 Tarea';
        dropdownOptionItem.innerHTML = '📁 Subcarpeta';
    }
}

function saveData() {
    localStorage.setItem('tasker_data', JSON.stringify(folders));
    syncToGitHub();
}

async function syncToGitHub() {
    if (!ghConfig.user || !ghConfig.repo || !ghConfig.token) return;

    const path = 'data.json';
    const url = `https://api.github.com/repos/${ghConfig.user}/${ghConfig.repo}/contents/${path}`;
    const contentEncoded = btoa(unescape(encodeURIComponent(JSON.stringify(folders, null, 2))));

    try {
        let sha = '';
        const getRes = await fetch(url, {
            headers: { 'Authorization': `token ${ghConfig.token}` }
        });
        if (getRes.ok) {
            const fileData = await getRes.json();
            sha = fileData.sha;
        }

        const bodyData = {
            message: "Auto-sync Tasker data",
            content: contentEncoded,
        };
        if (sha) bodyData.sha = sha;

        await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${ghConfig.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(bodyData)
        });
    } catch (err) {
        console.error("Error sincronizando con GitHub:", err);
    }
}

async function syncFromGitHub() {
    if (!ghConfig.user || !ghConfig.repo || !ghConfig.token) return;

    const path = 'data.json';
    const url = `https://api.github.com/repos/${ghConfig.user}/${ghConfig.repo}/contents/${path}`;
    
    try {
        const res = await fetch(url, {
            headers: { 'Authorization': `token ${ghConfig.token}` }
        });
        if (res.ok) {
            const fileData = await res.json();
            const decodedContent = decodeURIComponent(escape(atob(fileData.content)));
            folders = JSON.parse(decodedContent);
            folders.forEach(f => { 
                if (!f.subfolders) f.subfolders = []; 
                if (!f.icon) f.icon = '📁';
                if (f.tasks) {
                    f.tasks.forEach(t => {
                        if (!t.createdAt) t.createdAt = new Date().toISOString();
                        if (t.completedAt === undefined) t.completedAt = t.done ? t.createdAt : null;
                        if (t.dueDate === undefined) t.dueDate = null;
                    });
                }
            });
            localStorage.setItem('tasker_data', JSON.stringify(folders));
            render();
        }
    } catch (err) {
        console.error("Error cargando de GitHub:", err);
    }
}

function findFolderById(list, id) {
    for (let folder of list) {
        if (folder.id === id) return folder;
        if (folder.subfolders && folder.subfolders.length > 0) {
            const found = findFolderById(folder.subfolders, id);
            if (found) return found;
        }
    }
    return null;
}

function getCurrentFolder() {
    if (navigationStack.length === 0) return null;
    const currentId = navigationStack[navigationStack.length - 1];
    return findFolderById(folders, currentId);
}

function render() {
    const currentFolder = getCurrentFolder();
    if (currentFolder === null) {
        renderRootView();
    } else {
        renderFolderDetailView(currentFolder);
    }
    updateActionNavbar();
}

function updateActionNavbar() {
    if (isMultiSelectMode && (selectedIds.size > 0 || selectedFolderIds.size > 0)) {
        actionNavbar.classList.remove('hidden');
    } else {
        actionNavbar.classList.add('hidden');
    }
}

function exitMultiSelect() {
    isMultiSelectMode = false;
    selectedIds.clear();
    selectedFolderIds.clear();
    render();
}

function navbarRename() {
    if (selectedIds.size === 1 && selectedFolderIds.size === 0) {
        renameTask(Array.from(selectedIds)[0]);
        exitMultiSelect();
    } else if (selectedFolderIds.size === 1 && selectedIds.size === 0) {
        renameFolder(Array.from(selectedFolderIds)[0]);
        exitMultiSelect();
    } else {
        alert("Selecciona solo un elemento para renombrar.");
    }
}

function navbarDate() {
    if (selectedIds.size === 1 && selectedFolderIds.size === 0) {
        setTaskDueDate(Array.from(selectedIds)[0]);
        exitMultiSelect();
    } else {
        alert("Selecciona solo una tarea para configurar su fecha límite.");
    }
}

function navbarCopy() {
    if (selectedIds.size === 1 && selectedFolderIds.size === 0) {
        copyTask(Array.from(selectedIds)[0]);
        exitMultiSelect();
    } else if (selectedFolderIds.size === 1 && selectedIds.size === 0) {
        copyFolder(Array.from(selectedFolderIds)[0]);
        exitMultiSelect();
    } else {
        alert("Selecciona solo un elemento para copiar.");
    }
}

function navbarDelete() {
    const total = selectedIds.size + selectedFolderIds.size;
    if (confirm(`¿Seguro que quieres eliminar los ${total} elementos seleccionados?`)) {
        const folder = getCurrentFolder();
        if (folder) {
            folder.tasks = folder.tasks.filter(t => !selectedIds.has(t.id));
        }
        selectedFolderIds.forEach(id => {
            deleteFolderRecursive(folders, id);
            if (navigationStack.includes(id)) {
                navigationStack = navigationStack.slice(0, navigationStack.indexOf(id));
            }
        });
        saveData();
        exitMultiSelect();
    }
}

function renderRootView() {
    selectorContainer.classList.add('hidden');
    inputEl.placeholder = "Crear nueva carpeta principal...";
    
    function countPendingRecursive(list) {
        let count = 0;
        list.forEach(f => {
            count += f.tasks.filter(t => !t.done).length;
            if (f.subfolders) count += countPendingRecursive(f.subfolders);
        });
        return count;
    }
    const totalTasks = countPendingRecursive(folders);

    headerEl.innerHTML = `
        <div>
            <h1 class="text-2xl font-bold tracking-tight text-white flex items-center gap-1.5">
                Tasker <span class="text-indigo-400">📁</span>
            </h1>
            <p class="text-xs text-slate-400">Carpetas principales</p>
        </div>
        <div class="flex items-center gap-2">
            <div class="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-full text-xs font-medium text-indigo-400">
                ${totalTasks} pendientes
            </div>
            <button onclick="openSettings()" class="w-9 h-9 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-300 hover:text-white transition-colors cursor-pointer" title="Configurar GitHub">
                ⚙️
            </button>
        </div>
    `;

    mainEl.innerHTML = '';

    if (clipboard && clipboard.type === 'folder') {
        renderPasteBanner(mainEl);
    }

    if (folders.length === 0) {
        if (!clipboard) {
            mainEl.innerHTML += `
                <div class="text-center py-24 text-slate-600 text-sm">
                    No hay carpetas todavía.<br>Crea una abajo con el botón <b>+</b>.
                </div>
            `;
        }
        return;
    }

    folders.forEach(folder => renderFolderCard(folder, mainEl));
}

function renderFolderDetailView(folder) {
    if (!folder.subfolders) folder.subfolders = [];
    if (!folder.tasks) folder.tasks = [];

    const hasSubfolders = folder.subfolders.length > 0;
    const hasTasks = folder.tasks.length > 0;
    const isEmpty = !hasSubfolders && !hasTasks;

    if (isEmpty) {
        selectorContainer.classList.remove('hidden');
        updateSelectorUI();
        inputEl.placeholder = currentCreationMode === 'folder' ? 'Nombre de la nueva subcarpeta...' : `Añadir tarea en ${folder.name}...`;
    } else if (hasSubfolders) {
        selectorContainer.classList.add('hidden');
        inputEl.placeholder = `Crear subcarpeta en ${folder.name}...`;
    } else {
        selectorContainer.classList.add('hidden');
        inputEl.placeholder = `Añadir tarea en ${folder.name}...`;
    }

    const pendingCount = folder.tasks.filter(t => !t.done).length;

    let breadcrumbHtml = '';
    navigationStack.forEach((id) => {
        const f = findFolderById(folders, id);
        if (f) breadcrumbHtml += `<span class="text-slate-500">/</span> <span class="text-slate-300">${f.name}</span>`;
    });

    headerEl.innerHTML = `
        <div class="flex items-center gap-3">
            <button onclick="goBack()" class="w-8 h-8 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-300 hover:text-white transition-colors cursor-pointer">
                ←
            </button>
            <div>
                <h1 class="text-xl font-bold tracking-tight text-white flex items-center gap-1">${folder.name}</h1>
                <p class="text-xs text-slate-400">Contenido ${breadcrumbHtml}</p>
            </div>
        </div>
        <div class="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-full text-xs font-medium text-indigo-400">
            ${pendingCount} pendientes
        </div>
    `;

    mainEl.innerHTML = '';

    if (clipboard) {
        renderPasteBanner(mainEl);
    }

    if (hasTasks) {
        const controlsWrapper = document.createElement('div');
        controlsWrapper.className = "flex flex-col gap-2 mb-3";

        const filterContainer = document.createElement('div');
        filterContainer.className = "flex gap-1.5 bg-slate-900/60 p-1 rounded-xl border border-slate-800/80 text-xs";
        
        const filters = [
            { id: 'all', label: 'Todas' },
            { id: 'pending', label: 'Pendientes' },
            { id: 'completed', label: 'Completadas' }
        ];

        filters.forEach(f => {
            const btn = document.createElement('button');
            btn.type = "button";
            btn.className = `flex-1 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                currentFilter === f.id ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`;
            btn.textContent = f.label;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                currentFilter = f.id;
                renderFolderDetailView(folder);
            });
            filterContainer.appendChild(btn);
        });
        controlsWrapper.appendChild(filterContainer);

        const sortNames = {
            recent: '🕒 Más recientes',
            oldest: '⏳ Más antiguas',
            az: '🔤 Nombre (A-Z)'
        };

        const sortWrapper = document.createElement('div');
        sortWrapper.className = "relative bg-slate-900/60 border border-slate-800/80 px-4 py-2.5 rounded-xl flex items-center justify-between text-xs gap-3";
        sortWrapper.innerHTML = `
            <span class="text-slate-400 font-medium whitespace-nowrap">Ordenar por:</span>
            <div class="relative flex-1">
                <div id="sort-select-btn" class="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-3.5 py-2 rounded-xl flex items-center justify-between cursor-pointer shadow-md shadow-indigo-600/30 transition-all select-none w-full">
                    <span class="truncate">${sortNames[currentSort]}</span>
                    <span class="w-5 h-5 rounded-full bg-white/25 flex items-center justify-center text-[10px] font-bold flex-shrink-0 ml-2">▼</span>
                </div>
                <div id="sort-dropdown-menu" class="hidden absolute top-full mt-2 right-0 w-full bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden z-40">
                    <div class="p-1 space-y-1 text-xs">
                        <div onclick="setSort('recent')" class="px-3 py-2 text-slate-200 hover:bg-slate-800 rounded-xl cursor-pointer font-medium transition-colors">🕒 Más recientes</div>
                        <div onclick="setSort('oldest')" class="px-3 py-2 text-slate-200 hover:bg-slate-800 rounded-xl cursor-pointer font-medium transition-colors">⏳ Más antiguas</div>
                        <div onclick="setSort('az')" class="px-3 py-2 text-slate-200 hover:bg-slate-800 rounded-xl cursor-pointer font-medium transition-colors">🔤 Nombre (A-Z)</div>
                    </div>
                </div>
            </div>
        `;

        sortWrapper.querySelector('#sort-select-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            const menu = sortWrapper.querySelector('#sort-dropdown-menu');
            menu.classList.toggle('hidden');
        });

        controlsWrapper.appendChild(sortWrapper);
        mainEl.appendChild(controlsWrapper);
    }

    if (hasSubfolders) {
        const subContainer = document.createElement('div');
        subContainer.className = "space-y-2 mb-3";
        folder.subfolders.forEach(sub => renderFolderCard(sub, subContainer));
        mainEl.appendChild(subContainer);
    }

    if (hasTasks) {
        const tasksContainer = document.createElement('div');
        tasksContainer.className = "space-y-2";

        let tasksToShow = [...folder.tasks];
        
        if (currentFilter === 'pending') {
            tasksToShow = tasksToShow.filter(t => !t.done);
        } else if (currentFilter === 'completed') {
            tasksToShow = tasksToShow.filter(t => t.done);
        }

        if (currentSort === 'recent') {
            tasksToShow.sort((a, b) => b.id - a.id);
        } else if (currentSort === 'oldest') {
            tasksToShow.sort((a, b) => a.id - b.id);
        } else if (currentSort === 'az') {
            tasksToShow.sort((a, b) => a.text.localeCompare(b.text, 'es', { sensitivity: 'base' }));
        }

        if (tasksToShow.length === 0) {
            tasksContainer.innerHTML = `
                <div class="text-center py-10 text-slate-600 text-sm">
                    No hay tareas en este filtro.
                </div>
            `;
        } else {
            tasksToShow.forEach(task => {
                const item = document.createElement('div');
                const isSelected = selectedIds.has(task.id);

                item.className = `relative overflow-hidden flex items-start gap-3.5 p-4 rounded-2xl border transition-all duration-200 cursor-pointer ${
                    isSelected ? 'bg-indigo-950/70 border-indigo-500 shadow-lg shadow-indigo-600/20' :
                    task.done ? 'bg-slate-900/35 border-slate-900/40 opacity-50' : 'bg-slate-900/80 border-slate-800/80 shadow-md shadow-black/20 hover:border-slate-700'
                }`;

                addLongPressEvents(item, task.id, 'task');

                item.addEventListener('click', () => {
                    if (isMultiSelectMode) {
                        toggleSelectTask(task.id);
                    } else {
                        toggleTask(task.id);
                    }
                });

                const isExpanded = expandedTasks.has(task.id);
                const formattedDate = task.dueDate ? new Date(task.dueDate).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : null;

                item.innerHTML = `
                    <div class="w-5 h-5 mt-0.5 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                        isSelected ? 'bg-indigo-600 border-indigo-600 text-white' :
                        task.done ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-700 bg-slate-950'
                    }">
                        ${isSelected || task.done ? '<span class="text-xs">✓</span>' : ''}
                    </div>
                    <div class="flex-1">
                        <span id="task-text-${task.id}" class="text-sm font-medium block ${task.done ? 'text-slate-400' : 'text-slate-200'} ${isExpanded ? '' : 'line-clamp-3'}">
                            ${task.text}
                        </span>
                        ${formattedDate ? `<span class="inline-flex items-center gap-1 text-[11px] text-indigo-400 font-medium mt-1.5 bg-indigo-950/60 px-2 py-0.5 rounded-md border border-indigo-500/30">📅 ${formattedDate}</span>` : ''}
                        <button type="button" id="task-btn-${task.id}" onclick="event.stopPropagation(); toggleExpandTask(${task.id})" class="text-xs text-indigo-400 font-semibold mt-1 hover:underline hidden">
                            ${isExpanded ? 'Ver menos' : '... Ver más'}
                        </button>
                    </div>
                `;
                tasksContainer.appendChild(item);

                setTimeout(() => {
                    const textSpan = document.getElementById(`task-text-${task.id}`);
                    const btn = document.getElementById(`task-btn-${task.id}`);
                    if (textSpan && btn) {
                        if (isExpanded || textSpan.scrollHeight > 60) {
                            btn.classList.remove('hidden');
                        }
                    }
                }, 10);
            });
        }
        mainEl.appendChild(tasksContainer);
    }

    if (isEmpty && !clipboard) {
        mainEl.innerHTML = `
            <div class="text-center py-20 text-slate-600 text-sm">
                Carpeta vacía.<br>Usa el botón superior para cambiar entre subcarpeta o tarea.
            </div>
        `;
    }
}

function toggleSelectTask(id) {
    if (selectedIds.has(id)) {
        selectedIds.delete(id);
        if (selectedIds.size === 0 && selectedFolderIds.size === 0) isMultiSelectMode = false;
    } else {
        selectedIds.add(id);
    }
    render();
}

function toggleSelectFolder(id) {
    if (selectedFolderIds.has(id)) {
        selectedFolderIds.delete(id);
        if (selectedIds.size === 0 && selectedFolderIds.size === 0) isMultiSelectMode = false;
    } else {
        selectedFolderIds.add(id);
    }
    render();
}

function setSort(sortType) {
    currentSort = sortType;
    render();
}

function toggleExpandTask(taskId) {
    if (expandedTasks.has(taskId)) {
        expandedTasks.delete(taskId);
    } else {
        expandedTasks.add(taskId);
    }
    render();
}

function renderFolderCard(folder, container) {
    if (!folder.subfolders) folder.subfolders = [];
    if (!folder.tasks) folder.tasks = [];
    if (!folder.icon) folder.icon = '📁';

    const totalTasks = folder.tasks.length;
    const completedTasks = folder.tasks.filter(t => t.done).length;
    const pendingTasks = totalTasks - completedTasks;
    const subCount = folder.subfolders.length;
    const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    const isSelected = selectedFolderIds.has(folder.id);

    const card = document.createElement('div');
    card.className = `relative overflow-hidden group flex flex-col p-4 rounded-2xl border transition-all duration-200 gap-3 cursor-pointer ${
        isSelected ? 'bg-indigo-950/70 border-indigo-500 shadow-lg shadow-indigo-600/20' :
        'bg-slate-900/80 border-slate-800/80 shadow-md shadow-black/30 hover:border-indigo-500/50'
    }`;
    
    addLongPressEvents(card, folder.id, 'folder');
    card.addEventListener('click', () => {
        if (isMultiSelectMode) {
            toggleSelectFolder(folder.id);
        } else {
            openFolder(folder.id);
        }
    });

    card.innerHTML = `
        <div class="flex items-center justify-between">
            <div class="flex items-center gap-3.5 flex-1">
                <div onclick="event.stopPropagation(); changeFolderIcon(${folder.id})" class="w-10 h-10 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-lg hover:border-indigo-500 transition-colors flex-shrink-0" title="Cambiar icono">
                    ${folder.icon}
                </div>
                <div>
                    <h3 class="text-sm font-semibold text-slate-200">${folder.name}</h3>
                    <p class="text-xs text-slate-500">${subCount > 0 ? subCount + ' subcarpetas · ' : ''}${pendingTasks} pendientes · ${totalTasks} tareas</p>
                </div>
            </div>
        </div>
        ${totalTasks > 0 ? `
        <div class="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800/50">
            <div class="bg-indigo-500 h-full transition-all duration-500 rounded-full" style="width: ${progressPercent}%"></div>
        </div>` : ''}
    `;
    container.appendChild(card);
}

function changeFolderIcon(id) {
    const folder = findFolderById(folders, id);
    if (!folder) return;
    const newIcon = prompt("Introduce un emoji o símbolo para el icono de la carpeta:", folder.icon || '📁');
    if (newIcon && newIcon.trim() !== "") {
        folder.icon = newIcon.trim();
        saveData();
        render();
    }
}

function addLongPressEvents(element, id, type) {
    let timer = null;
    const start = (e) => {
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
        timer = setTimeout(() => {
            isMultiSelectMode = true;
            if (type === 'task') selectedIds.add(id);
            else selectedFolderIds.add(id);
            render();
        }, 600);
    };
    const cancel = () => { if (timer) clearTimeout(timer); };

    element.addEventListener('touchstart', start, {passive: true});
    element.addEventListener('touchend', cancel);
    element.addEventListener('touchmove', cancel);
    element.addEventListener('mousedown', start);
    element.addEventListener('mouseup', cancel);
    element.addEventListener('mouseleave', cancel);
}

function closeAllContextMenus() {
    document.querySelectorAll('.context-menu').forEach(menu => menu.remove());
}

function copyFolder(id) {
    const folder = findFolderById(folders, id);
    if (!folder) return;
    clipboard = { type: 'folder', data: JSON.parse(JSON.stringify(folder)) };
    alert("Carpeta copiada al portapapeles.");
    render();
}

function copyTask(id) {
    const folder = getCurrentFolder();
    if (!folder) return;
    const task = folder.tasks.find(t => t.id === id);
    if (!task) return;
    clipboard = { type: 'task', data: JSON.parse(JSON.stringify(task)) };
    alert("Tarea copiada al portapapeles.");
    render();
}

function pasteElement() {
    if (!clipboard) return;
    const currentFolder = getCurrentFolder();

    if (clipboard.type === 'folder') {
        function reassignIds(f) {
            f.id = Date.now() + Math.random();
            if (f.subfolders) f.subfolders.forEach(reassignIds);
            if (f.tasks) {
                f.tasks.forEach(t => {
                    t.id = Date.now() + Math.random();
                    t.createdAt = new Date().toISOString();
                    if (t.done) t.completedAt = new Date().toISOString();
                });
            }
            return f;
        }
        const clonedFolder = reassignIds(JSON.parse(JSON.stringify(clipboard.data)));
        clonedFolder.name += ' (Copia)';

        if (currentFolder) {
            currentFolder.subfolders.push(clonedFolder);
        } else {
            folders.push(clonedFolder);
        }
    } else if (clipboard.type === 'task') {
        if (currentFolder) {
            currentFolder.tasks.unshift({
                ...clipboard.data,
                id: Date.now(),
                text: clipboard.data.text + ' (Copia)',
                createdAt: new Date().toISOString(),
                completedAt: clipboard.data.done ? new Date().toISOString() : null
            });
        } else {
            alert("Las tareas solo se pueden pegar dentro de carpetas.");
            return;
        }
    }

    clipboard = null;
    saveData();
    render();
}

function renderPasteBanner(container) {
    const banner = document.createElement('div');
    banner.className = "bg-indigo-950/60 border border-indigo-500/40 p-3 rounded-2xl flex items-center justify-between mb-3 shadow-md";
    banner.innerHTML = `
        <div class="flex items-center gap-2 text-xs text-indigo-300 font-medium">
            <span>📥 Elemento en portapapeles (${clipboard.type === 'folder' ? 'Carpeta' : 'Tarea'})</span>
        </div>
        <button onclick="pasteElement()" class="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer">
            Pegar aquí
        </button>
    `;
    container.appendChild(banner);
}

function renameFolder(id) {
    const folder = findFolderById(folders, id);
    if (!folder) return;
    const newName = prompt("Nuevo nombre para la carpeta:", folder.name);
    if (newName && newName.trim() !== "") {
        folder.name = newName.trim();
        saveData();
        render();
    }
}

function renameTask(id) {
    const folder = getCurrentFolder();
    if (!folder) return;
    const task = folder.tasks.find(t => t.id === id);
    if (!task) return;
    const newText = prompt("Editar texto de la tarea:", task.text);
    if (newText && newText.trim() !== "") {
        task.text = newText.trim();
        saveData();
        render();
    }
}

function setTaskDueDate(id) {
    const folder = getCurrentFolder();
    if (!folder) return;
    const task = folder.tasks.find(t => t.id === id);
    if (!task) return;
    
    activeTaskIdForDate = id;
    modalDatetimeInput.value = task.dueDate ? task.dueDate.slice(0, 16) : '';
    dateModal.showModal();
}

function closeDateModal(save) {
    if (save && activeTaskIdForDate !== null) {
        const folder = getCurrentFolder();
        if (folder) {
            const task = folder.tasks.find(t => t.id === activeTaskIdForDate);
            if (task) {
                const val = modalDatetimeInput.value;
                if (!val) {
                    task.dueDate = null;
                } else {
                    const parsed = new Date(val);
                    if (!isNaN(parsed.getTime())) {
                        task.dueDate = parsed.toISOString();
                        task.notified = false;
                    }
                }
                saveData();
                render();
            }
        }
    }
    activeTaskIdForDate = null;
    dateModal.close();
}

formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;

    const currentFolder = getCurrentFolder();

    if (currentFolder === null) {
        folders.push({
            id: Date.now(),
            name: text,
            icon: '📁',
            subfolders: [],
            tasks: []
        });
    } else {
        const hasSubfolders = currentFolder.subfolders.length > 0;
        const hasTasks = currentFolder.tasks.length > 0;
        const isEmpty = !hasSubfolders && !hasTasks;

        let actionType = 'task';
        if (hasSubfolders) actionType = 'folder';
        else if (hasTasks) actionType = 'task';
        else if (isEmpty) actionType = currentCreationMode;

        if (actionType === 'folder') {
            currentFolder.subfolders.push({
                id: Date.now(),
                name: text,
                icon: '📁',
                subfolders: [],
                tasks: []
            });
        } else {
            currentFolder.tasks.unshift({
                id: Date.now(),
                text: text,
                done: false,
                dueDate: null,
                createdAt: new Date().toISOString(),
                completedAt: null
            });
        }
    }

    inputEl.value = '';
    saveData();
    render();
});

function openFolder(id) {
    navigationStack.push(id);
    currentFilter = 'all';
    render();
}

function goBack() {
    navigationStack.pop();
    currentFilter = 'all';
    render();
}

function openSettings() {
    const user = prompt("Introduce tu usuario de GitHub:", ghConfig.user);
    if (user === null) return;
    const repo = prompt("Introduce el nombre del repositorio:", ghConfig.repo);
    if (repo === null) return;
    const token = prompt("Introduce tu Personal Access Token:", ghConfig.token);
    if (token === null) return;

    ghConfig = { user: user.trim(), repo: repo.trim(), token: token.trim() };
    localStorage.setItem('tasker_gh_config', JSON.stringify(ghConfig));
    alert("¡Configuración guardada! Sincronizando...");
    syncFromGitHub();
}

function toggleTask(taskId) {
    const folder = getCurrentFolder();
    if (!folder) return;
    folder.tasks = folder.tasks.map(t => {
        if (t.id === taskId) {
            const newDone = !t.done;
            return {
                ...t,
                done: newDone,
                completedAt: newDone ? new Date().toISOString() : null
            };
        }
        return t;
    });
    saveData();
    render();
}

if (ghConfig.user && ghConfig.repo && ghConfig.token) {
    syncFromGitHub();
} else {
    render();
}

// Comprobar notificaciones mediante la función sin servidor de Netlify cada minuto
setInterval(checkRemoteTaskNotifications, 60000);

async function checkRemoteTaskNotifications() {
    // Si el usuario no ha configurado sus credenciales de GitHub en la app, no se puede verificar en remoto
    if (!ghConfig.user || !ghConfig.repo || !ghConfig.token) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    try {
        const response = await fetch('/.netlify/functions/check-tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user: ghConfig.user,
                repo: ghConfig.repo,
                token: ghConfig.token,
                folders: folders
            })
        });

        if (!response.ok) return;

        const result = await response.json();

        // Si la función de Netlify detecta tareas que deben notificarse
        if (result.success && result.triggered && result.triggered.length > 0) {
            result.triggered.forEach(async (alertItem) => {
                const title = "⚠️ Tarea próxima";
                const options = {
                    body: `Eh tú, sí, tú. Que tienes de ${alertItem.folderName} hacer ${alertItem.taskText}`,
                    icon: "/icon.svg",
                    badge: "/icon.svg",
                    vibrate: [200, 100, 200],
                    tag: `task-${alertItem.taskId}`
                };

                // Lanzar la notificación mediante el Service Worker o fallback
                if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                    try {
                        const registration = await navigator.serviceWorker.ready;
                        registration.showNotification(title, options);
                    } catch (e) {
                        new Notification(title, options);
                    }
                } else {
                    new Notification(title, options);
                }
            });

            // Actualizamos nuestras carpetas locales con el estado 'notified: true' que devolvió Netlify
            if (result.updatedFolders) {
                folders = result.updatedFolders;
                saveData(); // Guarda localmente y sincroniza de nuevo con GitHub
            }
        }
    } catch (err) {
        console.error("Error al comprobar notificaciones remotas:", err);
    }
}