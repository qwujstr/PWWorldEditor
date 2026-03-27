const GRID_X = 80, GRID_Y = 60, TILE = 32;
const BASE_PATH = 'textures/blocks/';

let globalFrame = 0;
setInterval(() => { globalFrame++; }, 150);

let blockLibrary = [];
const backgroundLibrary = [
    { name: 'None', file: null, icon: 'textures/ui/SoilBlueprint.png' },
    { name: 'Alien', file: 'Alien.png' }, { name: 'Candy', file: 'Candy.png' },
    { name: 'Cemetery', file: 'Cemetery.png' }, { name: 'City', file: 'City.png' },
    { name: 'Forest', file: 'Forest.png' }, { name: 'Night', file: 'Night.png' },
    { name: 'Sand', file: 'Sand.png' }, { name: 'Star', file: 'Star.png' },
    { name: 'Summer Sky', file: 'SummerSky.png' }, { name: 'Winter', file: 'Winter.png' }
];

const canvas = document.getElementById('worldCanvas');
const ctx = canvas.getContext('2d');
const viewport = document.getElementById('viewport');

let fgData = Array(GRID_X).fill().map(() => Array(GRID_Y).fill(null));
let bgData = Array(GRID_X).fill().map(() => Array(GRID_Y).fill(null));
let history = [];
let activeAtmosphere = null;

let activeTool = 'move', activeSlot = 0;
let hotbar = Array(10).fill(null);
let bucketBlock = null, shapeBlock = null;
let targetBlockForReplace = null;

let scale = 0.8, posX = 0, posY = 0;
let isPanning = false, isDrawing = false, showGrid = false;
let shapeStart = null;
const imgCache = {};

function autoLoadAssets() {
    if (typeof ASSET_LIST === 'undefined') {
        console.error("ASSET_LIST is missing");
        return;
    }
    blockLibrary = ASSET_LIST.map(asset => {
        const cleanName = asset.file
            .replace('_0.png', '')
            .replace('.png', '')
            .replace(/_/g, ' ');

        return {
            name: cleanName,
            fileName: asset.file,
            type: asset.folder === 'background' ? 'wall' : (asset.folder === 'water' ? 'water' : (asset.folder === 'prop' ? 'prop' : 'block')),
            texture: `${BASE_PATH}${asset.folder}/${asset.file}`,
            folder: asset.folder
        };
    });
    generateDefaultFloor();
    initUI();
    function generateDefaultFloor() {
        const findBlock = (filename) => blockLibrary.find(b => b.fileName === filename);

        const bedrock = findBlock('Bedrock.png');
        const lavaRock = findBlock('End Lava Rock.png');
        const lava = findBlock('End Lava.png');

        for (let x = 0; x < GRID_X; x++) {
            if (bedrock) fgData[x][57] = JSON.parse(JSON.stringify(bedrock));
            if (lavaRock) fgData[x][58] = JSON.parse(JSON.stringify(lavaRock));
            if (lava) fgData[x][59] = JSON.parse(JSON.stringify(lava));
        }
    }
}

function getBlockTexture(x, y, block) {
    if (!block) return null;
    if (block.fileName.includes('_0.png')) {
        const baseName = block.fileName.replace('_0.png', '');
        const frames = ASSET_LIST.filter(a =>
            a.file.startsWith(baseName + '_') && a.folder === block.folder
        );

        if (frames.length > 1) {
            const speed = 150; // ms per frame
            const currentFrame = Math.floor(performance.now() / speed) % frames.length;
            const animatedFileName = `${baseName}_${currentFrame}.png`;
            return getImg(`${BASE_PATH}${block.folder}/${animatedFileName}`);
        }
    }
    const altName = block.fileName.replace('.png', '_Alt.png');
    const isTopExposed = y === 0 || (fgData[x][y-1] === null || fgData[x][y-1]?.type === 'prop');
    const hasAlt = ASSET_LIST.some(a => a.file === altName && a.folder === block.folder);

    if (isTopExposed && hasAlt) {
        return getImg(`${BASE_PATH}${block.folder}/${altName}`);
    }

    return getImg(block.texture);
}

function saveHistory() {
    if (history.length > 50) history.shift();
    history.push({ fg: JSON.parse(JSON.stringify(fgData)), bg: JSON.parse(JSON.stringify(bgData)), atm: activeAtmosphere });
}

function undo() {
    if (history.length > 0) {
        const state = history.pop();
        fgData = state.fg; bgData = state.bg; setBackground(state.atm);
    }
}

function getImg(src) {
    if (!src) return null;
    if (!imgCache[src]) { imgCache[src] = new Image(); imgCache[src].src = src; }
    return imgCache[src];
}

function setBackground(bgFile) {
    activeAtmosphere = bgFile;
    canvas.style.backgroundImage = bgFile ? `url("textures/orbs/${bgFile}")` : 'none';
}

function updateTransform() { canvas.style.transform = `translate(${posX}px, ${posY}px) scale(${scale})`; }

function initUI() {
    const invList = document.getElementById('block-list');
    const bucketList = document.getElementById('block-list-bucket');
    const shapesList = document.getElementById('block-list-shapes');
    const bgList = document.getElementById('bg-list');
    const replaceSuggestions = document.getElementById('clear-suggestions');

    [invList, bucketList, shapesList, bgList, replaceSuggestions].forEach(l => { if(l) l.innerHTML = ''; });

    blockLibrary.forEach(b => {
        if (b.fileName.includes('_Alt') || b.fileName.includes('_Glow')) return;

        const frameMatch = b.fileName.match(/_(\d+)\.png$/);
        if (frameMatch && frameMatch[1] !== "0") return;

        const uiDisplayName = b.fileName
            .replace('_0.png', '')
            .replace('.png', '')
            .replace(/_/g, ' ');

        const createBtn = (container, callback) => {
            const btn = document.createElement('div');
            btn.className = 'block-btn';
            btn.innerHTML = `<img src="${b.texture}"><span>${uiDisplayName}</span>`;
            btn.onclick = () => callback(b);
            container.appendChild(btn);
        };

        createBtn(invList, (block) => {
            let targetSlot = hotbar.findIndex((slot, idx) => idx > 0 && slot === null);

            if (targetSlot === -1) {
                targetSlot = activeSlot === 0 ? 1 : activeSlot;
            }

            hotbar[targetSlot] = block;
            const slotElements = document.querySelectorAll('.slot');
            slotElements[targetSlot].innerHTML = `<img src="${block.texture}">`;

            selectSlot(targetSlot);
            closeAll();
        });

        if (bucketList) createBtn(bucketList, (block) => { bucketBlock = block; updateToolState('bucket'); closeAll(); });
        if (shapesList) createBtn(shapesList, (block) => { shapeBlock = block; updateToolState('shapes'); closeAll(); });

        const suggest = document.createElement('div');
        suggest.className = 'block-btn';
        suggest.innerHTML = `<img src="${b.texture}"><span>${uiDisplayName}</span>`;
        suggest.onclick = () => {
            targetBlockForReplace = b;
            document.getElementById('clear-search').value = uiDisplayName;
            document.getElementById('replace-desc').innerText = `Replacing all "${uiDisplayName}" with your active hotbar block.`;
            document.getElementById('replace-controls').classList.remove('hidden');
            replaceSuggestions.classList.add('hidden');
        };
        replaceSuggestions.appendChild(suggest);
    });

    backgroundLibrary.forEach(bg => {
        const btn = document.createElement('div');
        btn.className = 'block-btn';
        const iconSrc = bg.file ? `textures/orbs/${bg.file}` : bg.icon;
        btn.innerHTML = `<img src="${iconSrc}"><span>${bg.name}</span>`;
        btn.onclick = () => { saveHistory(); setBackground(bg.file); closeAll(); };
        bgList.appendChild(btn);
    });
}

function filterList(listId, term) {
    const list = document.getElementById(listId);
    const btns = list.querySelectorAll('.block-btn');
    btns.forEach(b => {
        const match = b.innerText.toLowerCase().includes(term.toLowerCase());
        b.style.display = match ? 'flex' : 'none';
    });
}

function updateToolState(tool) {
    activeTool = tool;
    document.getElementById('bucket-btn').classList.toggle('active-tool', tool === 'bucket');
    document.getElementById('shapes-btn').classList.toggle('active-tool', tool === 'shapes');
    document.getElementById('pick-btn').classList.toggle('active-tool', tool === 'pick');

    const display = document.getElementById('block-name');
    const formatDisplay = (txt) => txt ? txt.toUpperCase() : "NONE";

    if (tool === 'pick') display.innerText = "PICK BLOCK";
    else if (tool === 'bucket') display.innerHTML = `BUCKET (${formatDisplay(bucketBlock?.name)})`;
    else if (tool === 'shapes') display.innerHTML = `SHAPES (${formatDisplay(shapeBlock?.name)})`;
    else if (tool === 'move') display.innerText = "MOVE";
    else {
        const block = hotbar[activeSlot];
        display.innerText = block ? `BLOCK: ${formatDisplay(block.name)}` : "EMPTY SLOT";
    }

    if(tool !== 'hotbar') {
        document.querySelectorAll('.slot').forEach(s => s.classList.remove('active'));
    }
}

function selectSlot(i) {
    activeSlot = i;
    if (i === 0) updateToolState('move');
    else updateToolState('hotbar');
    document.querySelectorAll('.slot').forEach((s, idx) => s.classList.toggle('active', idx === i));
}

function openMenu(id) { closeAll(); document.getElementById(id).classList.remove('hidden'); document.getElementById('overlay').classList.remove('hidden'); }
function closeAll() { document.querySelectorAll('.menu-popup, #overlay, .suggestions-list').forEach(el => el.classList.add('hidden')); }

window.addEventListener('contextmenu', (e) => e.preventDefault());

const bindings = { 'inv-toggle': 'inventory-popup', 'bg-ui-btn': 'bg-popup', 'clear-menu-btn': 'clear-popup', 'help-btn': 'help-popup' };
Object.keys(bindings).forEach(id => { const el = document.getElementById(id); if(el) el.onclick = () => openMenu(bindings[id]); });

document.getElementById('bucket-btn').onclick = () => {
    if (activeTool === 'bucket') openMenu('bucket-popup');
    else updateToolState('bucket');
};
document.getElementById('shapes-btn').onclick = () => {
    if (activeTool === 'shapes') openMenu('shapes-popup');
    else updateToolState('shapes');
};

document.getElementById('inv-search').oninput = (e) => filterList('block-list', e.target.value);
document.getElementById('bucket-search').oninput = (e) => filterList('block-list-bucket', e.target.value);
document.getElementById('shapes-search').oninput = (e) => filterList('block-list-shapes', e.target.value);
document.getElementById('clear-search').oninput = (e) => {
    const term = e.target.value;
    const list = document.getElementById('clear-suggestions');
    if(term) { list.classList.remove('hidden'); filterList('clear-suggestions', term); }
    else { list.classList.add('hidden'); document.getElementById('replace-controls').classList.add('hidden'); }
};

document.getElementById('confirm-replace').onclick = () => {
    const newBlock = hotbar[activeSlot];
    if(!targetBlockForReplace || !newBlock) return alert("Select a block and an active hotbar block!");
    saveHistory();
    for(let x=0; x<GRID_X; x++) {
        for(let y=0; y<GRID_Y; y++) {
            if(fgData[x][y] && fgData[x][y].name === targetBlockForReplace.name) fgData[x][y] = JSON.parse(JSON.stringify(newBlock));
            if(bgData[x][y] && bgData[x][y].name === targetBlockForReplace.name) bgData[x][y] = JSON.parse(JSON.stringify(newBlock));
        }
    }
    closeAll();
};

document.getElementById('delete-all-trigger').onclick = () => {
    if(confirm("Delete EVERYTHING?")) {
        saveHistory();
        fgData = Array(GRID_X).fill().map(() => Array(GRID_Y).fill(null));
        bgData = Array(GRID_X).fill().map(() => Array(GRID_Y).fill(null));
        closeAll();
    }
};

document.querySelectorAll('.close-btn-fancy').forEach(b => b.onclick = closeAll);
document.getElementById('overlay').onclick = closeAll;
document.getElementById('grid-toggle').onclick = () => showGrid = !showGrid;

document.getElementById('save-btn').onclick = () => {
    const data = JSON.stringify({ fg: fgData, bg: bgData, atm: activeAtmosphere });
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'world.json'; a.click();
};

document.getElementById('import-btn').onclick = () => document.getElementById('file-input').click();
document.getElementById('file-input').onchange = (e) => {
    const reader = new FileReader();
    reader.onload = () => { const d = JSON.parse(reader.result); fgData = d.fg; bgData = d.bg; setBackground(d.atm); };
    reader.readAsText(e.target.files[0]);
};

viewport.onmousedown = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / scale) / TILE);
    const y = Math.floor(((e.clientY - rect.top) / scale) / TILE);

    if(e.button === 1 || activeTool === 'move') {
        isPanning = true;
        return;
    }

    if (activeTool === 'pick') {
        const picked = fgData[x][y] || bgData[x][y];
        if (picked) {
            let targetSlot = hotbar.findIndex((slot, idx) => idx > 0 && slot === null);
            if (targetSlot === -1) targetSlot = activeSlot === 0 ? 1 : activeSlot;

            hotbar[targetSlot] = JSON.parse(JSON.stringify(picked));
            const slotElements = document.querySelectorAll('.slot');
            slotElements[targetSlot].innerHTML = `<img src="${picked.texture}">`;

            selectSlot(targetSlot);
        }
        return;
    }

    saveHistory();
    if(activeTool === 'bucket') {
        if(e.button === 0) {
            if(!bucketBlock) openMenu('bucket-popup');
            else floodFill(x,y,bucketBlock);
        } else if (e.button === 2) {
            floodFill(x,y,null);
        }
    }
    else if(activeTool === 'shapes') {
        if(!shapeBlock) openMenu('shapes-popup');
        else { shapeStart = {x, y}; isDrawing = true; }
    }
    else {
        isDrawing = true;
        handlePlace(e);
    }
};

window.onmousemove = (e) => {
    if (isPanning) {
        posX += e.movementX;
        posY += e.movementY;
        updateTransform();
    } else if (isDrawing && activeTool !== 'shapes') {
        handlePlace(e);
    }
};

window.onmouseup = (e) => {
    if(activeTool === 'shapes' && shapeStart) {
        const rect = canvas.getBoundingClientRect();
        const x2 = Math.floor(((e.clientX - rect.left) / scale) / TILE);
        const y2 = Math.floor(((e.clientY - rect.top) / scale) / TILE);
        drawShape(shapeStart.x, shapeStart.y, x2, y2);
    }
    isPanning = false; isDrawing = false; shapeStart = null;
};

viewport.onwheel = (e) => { e.preventDefault(); scale = Math.min(Math.max(scale + (e.deltaY < 0 ? 0.1 : -0.1), 0.1), 5); updateTransform(); };

function handlePlace(e) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / scale) / TILE);
    const y = Math.floor(((e.clientY - rect.top) / scale) / TILE);

    if (x < 0 || x >= GRID_X || y < 0 || y >= GRID_Y) return;

    if (e.buttons === 1) {
        const b = hotbar[activeSlot];
        if (!b || activeSlot === 0) return;
        if (b.type === 'wall') bgData[x][y] = JSON.parse(JSON.stringify(b));
        else fgData[x][y] = JSON.parse(JSON.stringify(b));
    }
    else if (e.buttons === 2) {
        fgData[x][y] = null;
        bgData[x][y] = null;
    }
}

function floodFill(x, y, block) {
    const layer = (block && block.type === 'wall') ? bgData : fgData;
    const target = layer[x][y]?.name || null;
    if(block && target === block.name) return;
    const stack = [[x, y]];
    while(stack.length) {
        const [cx, cy] = stack.pop();
        if(cx<0 || cx>=GRID_X || cy<0 || cy>=GRID_Y || (layer[cx][cy]?.name || null) !== target) continue;
        layer[cx][cy] = block ? JSON.parse(JSON.stringify(block)) : null;
        stack.push([cx+1, cy], [cx-1, cy], [cx, cy+1], [cx, cy-1]);
    }
}

function drawShape(x1, y1, x2, y2) {
    const type = document.getElementById('shape-type').value;
    const fill = document.getElementById('shape-fill').checked;
    const layer = shapeBlock.type === 'wall' ? bgData : fgData;
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2), minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    for(let x = minX; x <= maxX; x++) {
        for(let y = minY; y <= maxY; y++) {
            if(x<0 || x>=GRID_X || y<0 || y>=GRID_Y) continue;
            let inside = false;
            if(type === 'rect') inside = fill ? true : (x===minX || x===maxX || y===minY || y===maxY);
            else if(type === 'circle') {
                const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, rx = (maxX - minX) / 2, ry = (maxY - minY) / 2;
                const d = Math.pow((x - cx) / (rx || 1), 2) + Math.pow((y - cy) / (ry || 1), 2);
                inside = fill ? d <= 1 : (d <= 1 && d >= 0.7);
            }
            if(inside) layer[x][y] = JSON.parse(JSON.stringify(shapeBlock));
        }
    }
}

function render(time) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const glowAlpha = (Math.sin(time * 0.002) + 1) / 2;

    for (let x = 0; x < GRID_X; x++) {
        for (let y = 0; y < GRID_Y; y++) {
            [bgData[x][y], fgData[x][y]].forEach(block => {
                if (!block) return;

                const baseTex = getBlockTexture(x, y, block);
                if (!baseTex) return;

                ctx.drawImage(baseTex, x * TILE, y * TILE, TILE, TILE);

                const glowName = block.fileName.replace('.png', '_Glow.png');
                const hasGlow = ASSET_LIST.some(a => a.file === glowName && a.folder === block.folder);

                if (hasGlow) {
                    const glowTex = getImg(`${BASE_PATH}${block.folder}/${glowName}`);
                    if (glowTex && glowTex.complete) {
                        ctx.save();
                        ctx.globalAlpha = glowAlpha;
                        ctx.drawImage(glowTex, x * TILE, y * TILE, TILE, TILE);
                        ctx.restore();
                    }
                }
            });
        }
    }

    if (showGrid) {
        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        for (let i = 0; i <= GRID_X; i++) {
            ctx.beginPath(); ctx.moveTo(i * TILE, 0); ctx.lineTo(i * TILE, canvas.height); ctx.stroke();
        }
        for (let i = 0; i <= GRID_Y; i++) {
            ctx.beginPath(); ctx.moveTo(0, i * TILE); ctx.lineTo(canvas.width, i * TILE); ctx.stroke();
        }
    }

    requestAnimationFrame(render);
}

const pickBtn = document.getElementById('pick-btn');
if (pickBtn) {
    pickBtn.onclick = () => updateToolState('pick');
}

window.onkeydown = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
        return;
    }

    const key = e.key.toLowerCase();

    if (key === 'f') updateToolState('bucket');
    if (key === 's') updateToolState('shapes');
    if (key === 'k') updateToolState('pick');
    if (key === 'm') selectSlot(0);

    if (e.key >= '1' && e.key <= '9') {
        selectSlot(parseInt(e.key));
    }
    if (e.key === '0') {
        selectSlot(0);
    }
};

document.getElementById('screenshot-btn').onclick = () => {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (activeAtmosphere) {
        const bgImg = getImg(`textures/orbs/${activeAtmosphere}`);
        if (bgImg && bgImg.complete) {
            tempCtx.drawImage(bgImg, 0, 0, tempCanvas.width, tempCanvas.height);
        } else {
            tempCtx.fillStyle = "#1a1a1a";
            tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        }
    } else {
        tempCtx.fillStyle = "#000";
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    }
    for (let x = 0; x < GRID_X; x++) {
        for (let y = 0; y < GRID_Y; y++) {
            if (bgData[x][y]) {
                const tex = getBlockTexture(x, y, bgData[x][y]);
                if (tex) tempCtx.drawImage(tex, x * TILE, y * TILE, TILE, TILE);
            }
            if (fgData[x][y]) {
                const tex = getBlockTexture(x, y, fgData[x][y]);
                if (tex) tempCtx.drawImage(tex, x * TILE, y * TILE, TILE, TILE);
            }
        }
    }
    const link = document.createElement('a');
    link.download = `PW_World_Export_${Date.now()}.png`;
    link.href = tempCanvas.toDataURL("image/png");
    link.click();
};

document.querySelectorAll('.slot').forEach(s => {
    s.onclick = () => selectSlot(parseInt(s.dataset.slot));
});

autoLoadAssets();
updateTransform();
render();