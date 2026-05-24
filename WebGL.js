var VSHADER_LIT_SOURCE = `
    attribute vec4 a_Position;
    attribute vec4 a_Normal;
    attribute vec2 a_TexCoord;
    uniform mat4 u_MvpMatrix;
    uniform mat4 u_modelMatrix;
    uniform mat4 u_normalMatrix;
    uniform mat4 u_MvpMatrixOfLight;
    varying vec3 v_Normal;
    varying vec3 v_PositionInWorld;
    varying vec2 v_TexCoord;
    varying vec4 v_PositionFromLight;
    void main(){
        gl_Position = u_MvpMatrix * a_Position;
        v_PositionInWorld = (u_modelMatrix * a_Position).xyz;
        v_Normal = normalize(vec3(u_normalMatrix * a_Normal));
        v_TexCoord = a_TexCoord;
        v_PositionFromLight = u_MvpMatrixOfLight * a_Position;
    }
`;

var FSHADER_LIT_SOURCE = `
    precision mediump float;
    uniform vec3 u_LightPosition;
    uniform vec3 u_ViewPosition;
    uniform vec3 u_Color;
    uniform float u_Ka;
    uniform float u_Kd;
    uniform float u_Ks;
    uniform float u_shininess;
    uniform bool u_useTexture;
    uniform bool u_useShadow;
    uniform sampler2D u_Sampler;
    uniform sampler2D u_ShadowMap;
    varying vec3 v_Normal;
    varying vec3 v_PositionInWorld;
    varying vec2 v_TexCoord;
    varying vec4 v_PositionFromLight;
    const float depthBias = 0.006;
    void main(){
        vec3 baseColor = u_Color;
        if(u_useTexture){
            baseColor *= texture2D(u_Sampler, v_TexCoord).rgb;
        }

        vec3 ambient = baseColor * u_Ka;
        vec3 normal = normalize(v_Normal);
        vec3 lightDirection = normalize(u_LightPosition - v_PositionInWorld);
        float nDotL = max(dot(lightDirection, normal), 0.0);
        vec3 diffuse = baseColor * u_Kd * nDotL;

        vec3 specular = vec3(0.0, 0.0, 0.0);
        if(nDotL > 0.0){
            vec3 reflected = reflect(-lightDirection, normal);
            vec3 viewDirection = normalize(u_ViewPosition - v_PositionInWorld);
            float specAngle = clamp(dot(reflected, viewDirection), 0.0, 1.0);
            specular = vec3(1.0) * u_Ks * pow(specAngle, u_shininess);
        }

        float visibility = 1.0;
        if(u_useShadow){
            vec3 shadowCoord = (v_PositionFromLight.xyz / v_PositionFromLight.w) * 0.5 + 0.5;
            if(shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 &&
               shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0 &&
               shadowCoord.z >= 0.0 && shadowCoord.z <= 1.0){
                float closestDepth = texture2D(u_ShadowMap, shadowCoord.xy).r;
                visibility = (shadowCoord.z > closestDepth + depthBias) ? 0.38 : 1.0;
            }
        }

        gl_FragColor = vec4((ambient + diffuse + specular) * visibility, 1.0);
    }
`;

var VSHADER_REFLECT_SOURCE = `
    attribute vec4 a_Position;
    attribute vec4 a_Normal;
    uniform mat4 u_MvpMatrix;
    uniform mat4 u_modelMatrix;
    uniform mat4 u_normalMatrix;
    varying vec3 v_Normal;
    varying vec3 v_PositionInWorld;
    void main(){
        gl_Position = u_MvpMatrix * a_Position;
        v_PositionInWorld = (u_modelMatrix * a_Position).xyz;
        v_Normal = normalize(vec3(u_normalMatrix * a_Normal));
    }
`;

var FSHADER_REFLECT_SOURCE = `
    precision mediump float;
    uniform vec3 u_ViewPosition;
    uniform vec3 u_Tint;
    uniform samplerCube u_envCubeMap;
    varying vec3 v_Normal;
    varying vec3 v_PositionInWorld;
    void main(){
        vec3 viewDirection = normalize(u_ViewPosition - v_PositionInWorld);
        vec3 reflected = reflect(-viewDirection, normalize(v_Normal));
        vec3 reflectedColor = textureCube(u_envCubeMap, reflected).rgb;
        gl_FragColor = vec4(reflectedColor * 0.82 + u_Tint * 0.28, 1.0);
    }
`;

var VSHADER_ENV_SOURCE = `
    attribute vec4 a_Position;
    varying vec4 v_Position;
    void main(){
        v_Position = a_Position;
        gl_Position = a_Position;
    }
`;

var FSHADER_ENV_SOURCE = `
    precision mediump float;
    uniform samplerCube u_envCubeMap;
    uniform mat4 u_viewDirectionProjectionInverse;
    varying vec4 v_Position;
    void main(){
        vec4 t = u_viewDirectionProjectionInverse * v_Position;
        vec3 dir = normalize(t.xyz / t.w);
        gl_FragColor = textureCube(u_envCubeMap, dir);
    }
`;

var VSHADER_SHADOW_SOURCE = `
    attribute vec4 a_Position;
    uniform mat4 u_MvpMatrix;
    void main(){
        gl_Position = u_MvpMatrix * a_Position;
    }
`;

var FSHADER_SHADOW_SOURCE = `
    precision mediump float;
    void main(){
        gl_FragColor = vec4(vec3(gl_FragCoord.z), 1.0);
    }
`;

var gl, canvas;
var litProgram, reflectProgram, envProgram, shadowProgram;
var quadObj, groundObj, cubeObj, sphereObj, playerObj;
var cubeMapTex, dynamicCubeFbo, shadowFbo;
var groundTexture;
var hudEl, messageEl, flashEl;
var lastTime = 0;
var gameStartedAt = 0;
var rotateAngle = 0;
var shadowSize = 1536;
var cubeSize = 256;
var arenaWidth = 4.6;
var arenaLength = 48.0;
var startZ = 45.0;
var light = { x: -3.2, y: 9.0, z: 10.0 };
var portal = { x: 0, y: 0.72, z: -46.0, radius: 0.95 };
var keys = {};
var mouseLastX = 0;
var mouseLastY = 0;
var mouseDragging = false;
var cameraMode = "third";
var cameraYaw = 180;
var language = "zh";
var TEXT = {
    en: {
        title: "Sky Crystal Escape",
        intro: "Run through the extended laser corridor, collect 11 crystals, then enter the mirror portal before the timer reaches zero.",
        move: "Move",
        moveValue: "WASD / Arrow Keys",
        jump: "Jump",
        jumpValue: "Space over low gates and lasers",
        camera: "Camera",
        cameraValue: "Mouse drag",
        view: "View",
        viewValue: "V switches first / third person",
        danger: "Danger",
        dangerValue: "Red lasers, blocks, and floor tiles cost HP",
        startPrompt: "Press Enter or click to start",
        languagePrompt: "Language",
        objective: "Objective: collect ",
        crystalsWord: " crystals",
        avoid: "Avoid red hazards",
        portalGoal: "Enter the mirror portal to win",
        pressStart: "Press Enter to start",
        crystals: "Crystals",
        hp: "HP",
        time: "Time",
        timeLeft: "Time Left",
        cameraMode: "Camera",
        third: "Third-person",
        first: "First-person",
        win: "You Win",
        lose: "Game Over",
        restart: "Press R to restart",
        collectFeedback: "Crystal collected",
        hazardFeedback: "Hazard hit",
        laserFeedback: "Laser hit",
        floorFeedback: "Danger floor",
        timeOut: "Time ran out",
        hpZero: "HP reached 0",
        portalOpened: "The mirror portal opened"
    },
    zh: {
        title: "天空水晶逃脫",
        intro: "穿越加長雷射長廊，收集 11 顆水晶，並在時間歸零前進入鏡面傳送門。",
        move: "移動",
        moveValue: "WASD / 方向鍵",
        jump: "跳躍",
        jumpValue: "Space 跳過矮牆與雷射",
        camera: "鏡頭",
        cameraValue: "滑鼠拖曳",
        view: "視角",
        viewValue: "V 切換第一 / 第三人稱",
        danger: "危險",
        dangerValue: "紅色雷射、方塊、地板會扣血",
        startPrompt: "按 Enter 或點擊開始",
        languagePrompt: "語言",
        objective: "目標：收集 ",
        crystalsWord: " 顆水晶",
        avoid: "避開紅色危險物",
        portalGoal: "進入鏡面傳送門即可獲勝",
        pressStart: "按 Enter 開始",
        crystals: "水晶",
        hp: "生命",
        time: "時間",
        timeLeft: "剩餘時間",
        cameraMode: "視角",
        third: "第三人稱",
        first: "第一人稱",
        win: "成功逃脫",
        lose: "遊戲結束",
        restart: "按 R 重新開始",
        collectFeedback: "取得水晶",
        hazardFeedback: "撞到障礙",
        laserFeedback: "碰到雷射",
        floorFeedback: "踩到危險地板",
        timeOut: "時間歸零",
        hpZero: "生命歸零",
        portalOpened: "鏡面傳送門已開啟"
    }
};
var player = {
    x: 0,
    y: 0,
    z: startZ,
    yaw: 180,
    pitch: -6,
    hp: 3,
    radius: 0.38,
    verticalSpeed: 0,
    grounded: true,
    invincible: 0
};
var game = {
    state: "start",
    totalTime: 190,
    timeLeft: 190,
    collected: 0,
    messageTimer: 0,
    feedback: ""
};
var crystals = [
    { x: 0.0, y: 0.55, z: 40.0, collected: false },
    { x: 1.45, y: 0.55, z: 32.0, collected: false },
    { x: 1.5, y: 0.55, z: 24.0, collected: false },
    { x: 0.0, y: 0.55, z: 16.0, collected: false },
    { x: 1.45, y: 0.55, z: 8.0, collected: false },
    { x: 1.5, y: 0.55, z: 0.0, collected: false },
    { x: 0.0, y: 0.55, z: -8.0, collected: false },
    { x: -1.5, y: 0.55, z: -16.0, collected: false },
    { x: 1.5, y: 0.55, z: -24.0, collected: false },
    { x: 0.0, y: 0.55, z: -32.0, collected: false },
    { x: -1.5, y: 0.55, z: -40.0, collected: false }
];
var hazards = [
    { x: -1.65, z: 36.0, sx: 0.62, sz: 0.62 },
    { x: 1.65, z: 21.0, sx: 0.62, sz: 0.62 },
    { x: -1.75, z: 4.0, sx: 0.68, sz: 0.68 },
    { x: 1.75, z: -12.0, sx: 0.68, sz: 0.68 },
    { x: -1.55, z: -29.0, sx: 0.68, sz: 0.68 }
];
var movingHazards = [
    { baseX: 0.0, baseZ: 35.0, axis: "z", range: 1.1, speed: 1.8, sx: 4.55, sz: 0.08, phase: 0.0 },
    { baseX: 0.0, baseZ: 22.0, axis: "z", range: 1.0, speed: 2.2, sx: 4.55, sz: 0.08, phase: 1.8 },
    { baseX: 0.0, baseZ: 9.0, axis: "z", range: 1.2, speed: 2.0, sx: 4.55, sz: 0.08, phase: 3.0 },
    { baseX: 0.0, baseZ: -6.0, axis: "z", range: 1.0, speed: 2.5, sx: 4.55, sz: 0.08, phase: 4.4 },
    { baseX: 0.0, baseZ: -22.0, axis: "z", range: 1.2, speed: 2.1, sx: 4.55, sz: 0.08, phase: 5.6 },
    { baseX: 0.0, baseZ: -37.0, axis: "z", range: 1.0, speed: 2.3, sx: 4.55, sz: 0.08, phase: 6.8 }
];
var blockers = [
    { x: -2.2, z: 30.0, sx: 1.0, sz: 2.2 },
    { x: 2.2, z: 18.0, sx: 1.0, sz: 2.2 },
    { x: -2.2, z: 6.0, sx: 1.0, sz: 2.4 },
    { x: 2.2, z: -8.0, sx: 1.0, sz: 2.4 },
    { x: -2.2, z: -22.0, sx: 1.0, sz: 2.2 },
    { x: 2.2, z: -36.0, sx: 1.0, sz: 2.2 }
];
var jumpBarriers = [
    { x: 0.0, z: 41.0, sx: 4.15, sz: 0.22 },
    { x: 0.0, z: 28.0, sx: 4.15, sz: 0.22 },
    { x: 0.0, z: 15.0, sx: 4.15, sz: 0.22 },
    { x: 0.0, z: 1.0, sx: 4.15, sz: 0.22 },
    { x: 0.0, z: -13.0, sx: 4.15, sz: 0.22 },
    { x: 0.0, z: -28.0, sx: 4.15, sz: 0.22 }
];
var floorHazards = [];

async function main(){
    canvas = document.getElementById("webgl");
    hudEl = document.getElementById("hud");
    messageEl = document.getElementById("message");
    flashEl = document.getElementById("damageFlash");
    gl = canvas.getContext("webgl2");
    if(!gl){
        alert("This project needs WebGL2.");
        return;
    }

    litProgram = compileShader(gl, VSHADER_LIT_SOURCE, FSHADER_LIT_SOURCE);
    setupLitProgramLocations();
    reflectProgram = compileShader(gl, VSHADER_REFLECT_SOURCE, FSHADER_REFLECT_SOURCE);
    setupReflectProgramLocations();
    envProgram = compileShader(gl, VSHADER_ENV_SOURCE, FSHADER_ENV_SOURCE);
    setupEnvProgramLocations();
    shadowProgram = compileShader(gl, VSHADER_SHADOW_SOURCE, FSHADER_SHADOW_SOURCE);
    shadowProgram.a_Position = gl.getAttribLocation(shadowProgram, "a_Position");
    shadowProgram.u_MvpMatrix = gl.getUniformLocation(shadowProgram, "u_MvpMatrix");

    quadObj = createScreenQuad();
    groundObj = createGroundPlane();
    cubeObj = await loadOBJtoCreateVBO("cube.obj");
    sphereObj = await loadOBJtoCreateVBO("sphere.obj");
    playerObj = await loadOBJtoCreateVBO("sonic.obj");

    cubeMapTex = initProceduralCubeTexture(gl);
    groundTexture = createPlatformTexture(gl);
    shadowFbo = init2DFrameBuffer(gl, shadowSize, shadowSize);
    dynamicCubeFbo = initCubeFrameBuffer(gl, cubeSize);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    canvas.onmousedown = mouseDown;
    canvas.onmousemove = mouseMove;
    canvas.onmouseup = mouseUp;
    canvas.onmouseleave = function(){ mouseDragging = false; };
    document.onkeydown = keyDown;
    document.onkeyup = keyUp;
    messageEl.onclick = function(){
        if(game.state === "start"){
            startGame();
        }
    };
    showStartScreen();
    requestAnimationFrame(tick);
}

function setupLitProgramLocations(){
    litProgram.a_Position = gl.getAttribLocation(litProgram, "a_Position");
    litProgram.a_Normal = gl.getAttribLocation(litProgram, "a_Normal");
    litProgram.a_TexCoord = gl.getAttribLocation(litProgram, "a_TexCoord");
    litProgram.u_MvpMatrix = gl.getUniformLocation(litProgram, "u_MvpMatrix");
    litProgram.u_modelMatrix = gl.getUniformLocation(litProgram, "u_modelMatrix");
    litProgram.u_normalMatrix = gl.getUniformLocation(litProgram, "u_normalMatrix");
    litProgram.u_MvpMatrixOfLight = gl.getUniformLocation(litProgram, "u_MvpMatrixOfLight");
    litProgram.u_LightPosition = gl.getUniformLocation(litProgram, "u_LightPosition");
    litProgram.u_ViewPosition = gl.getUniformLocation(litProgram, "u_ViewPosition");
    litProgram.u_Color = gl.getUniformLocation(litProgram, "u_Color");
    litProgram.u_Ka = gl.getUniformLocation(litProgram, "u_Ka");
    litProgram.u_Kd = gl.getUniformLocation(litProgram, "u_Kd");
    litProgram.u_Ks = gl.getUniformLocation(litProgram, "u_Ks");
    litProgram.u_shininess = gl.getUniformLocation(litProgram, "u_shininess");
    litProgram.u_useTexture = gl.getUniformLocation(litProgram, "u_useTexture");
    litProgram.u_useShadow = gl.getUniformLocation(litProgram, "u_useShadow");
    litProgram.u_Sampler = gl.getUniformLocation(litProgram, "u_Sampler");
    litProgram.u_ShadowMap = gl.getUniformLocation(litProgram, "u_ShadowMap");
}

function setupReflectProgramLocations(){
    reflectProgram.a_Position = gl.getAttribLocation(reflectProgram, "a_Position");
    reflectProgram.a_Normal = gl.getAttribLocation(reflectProgram, "a_Normal");
    reflectProgram.u_MvpMatrix = gl.getUniformLocation(reflectProgram, "u_MvpMatrix");
    reflectProgram.u_modelMatrix = gl.getUniformLocation(reflectProgram, "u_modelMatrix");
    reflectProgram.u_normalMatrix = gl.getUniformLocation(reflectProgram, "u_normalMatrix");
    reflectProgram.u_ViewPosition = gl.getUniformLocation(reflectProgram, "u_ViewPosition");
    reflectProgram.u_Tint = gl.getUniformLocation(reflectProgram, "u_Tint");
    reflectProgram.u_envCubeMap = gl.getUniformLocation(reflectProgram, "u_envCubeMap");
}

function setupEnvProgramLocations(){
    envProgram.a_Position = gl.getAttribLocation(envProgram, "a_Position");
    envProgram.u_envCubeMap = gl.getUniformLocation(envProgram, "u_envCubeMap");
    envProgram.u_viewDirectionProjectionInverse = gl.getUniformLocation(envProgram, "u_viewDirectionProjectionInverse");
}

function tick(now){
    resizeCanvasToDisplaySize();
    var dt = Math.min((now - lastTime) / 1000, 0.04);
    lastTime = now;
    updateGame(dt, now);
    draw();
    requestAnimationFrame(tick);
}

function updateGame(dt, now){
    rotateAngle += dt * 70;
    if(game.state === "start"){
        updateHud();
        return;
    }
    if(game.state !== "playing"){
        updateHud();
        return;
    }

    game.timeLeft = Math.max(0, game.totalTime - (now - gameStartedAt) / 1000);
    player.invincible = Math.max(0, player.invincible - dt);
    game.messageTimer = Math.max(0, game.messageTimer - dt);
    if(game.messageTimer <= 0){
        game.feedback = "";
    }

    updateFloorHazards();
    updateJump(dt);
    movePlayer(dt);
    checkCrystalCollection();
    checkHazards();
    checkMovingHazards();
    checkFloorHazards();
    checkPortal();

    if(game.timeLeft <= 0){
        endGame(false, text().timeOut);
    }
    updateHud();
}

function getFloorHazardState(tile){
    var cycle = 4.8;
    var t = (performance.now() * 0.001 + tile.phase) % cycle;
    if(t < 1.9){
        return "safe";
    }
    if(t < 3.15){
        return "warning";
    }
    return "danger";
}

function updateFloorHazards(){
    var cycle = 4.8;
    var now = performance.now() * 0.001;
    for(var i = 0; i < floorHazards.length; i++){
        var tile = floorHazards[i];
        var cycleIndex = Math.floor((now + tile.phase) / cycle);
        var stateTime = (now + tile.phase) % cycle;
        if(tile.cycleIndex !== cycleIndex && stateTime < 0.25){
            relocateFloorHazard(tile);
            tile.cycleIndex = cycleIndex;
        }
    }
}

function randomizeFloorHazards(){
    floorHazards = [];
    var count = 7;
    var lanes = [-1.45, 0, 1.45];
    var minZ = -38;
    var maxZ = 34;
    var segment = (maxZ - minZ) / count;
    for(var i = 0; i < count; i++){
        var tile = {
            segmentIndex: i,
            zMin: minZ + segment * i + 1.0,
            zMax: minZ + segment * (i + 1) - 1.0,
            phase: randomRange(0, 4.8),
            cycleIndex: -1
        };
        relocateFloorHazard(tile);
        floorHazards.push(tile);
    }
}

function relocateFloorHazard(tile){
    var lanes = [-1.45, 0, 1.45];
    var lane = lanes[Math.floor(Math.random() * lanes.length)];
    tile.x = lane;
    tile.z = randomRange(tile.zMin, tile.zMax);
    tile.sx = lane === 0 ? 1.35 : 1.05;
    tile.sz = randomRange(1.35, 1.9);
}

function updateJump(dt){
    if((keys[" "] || keys["space"]) && player.grounded){
        player.verticalSpeed = 5.6;
        player.grounded = false;
    }
    player.verticalSpeed -= 13.5 * dt;
    player.y += player.verticalSpeed * dt;
    if(player.y <= 0){
        player.y = 0;
        player.verticalSpeed = 0;
        player.grounded = true;
    }
}

function movePlayer(dt){
    var speed = 4.2;
    var forward = getFlatForward();
    var right = [-forward[2], 0, forward[0]];
    var dx = 0;
    var dz = 0;

    if(keys["w"] || keys["arrowup"]){ dx += forward[0]; dz += forward[2]; }
    if(keys["s"] || keys["arrowdown"]){ dx -= forward[0]; dz -= forward[2]; }
    if(keys["d"] || keys["arrowright"]){ dx += right[0]; dz += right[2]; }
    if(keys["a"] || keys["arrowleft"]){ dx -= right[0]; dz -= right[2]; }

    var len = Math.sqrt(dx * dx + dz * dz);
    if(len > 0){
        dx /= len;
        dz /= len;
        player.x += dx * speed * dt;
        player.z += dz * speed * dt;
        player.yaw = Math.atan2(dx, dz) * 180 / Math.PI;
    }

    pushOutOfBlockers();
    pushOutOfJumpBarriers();

    player.x = clamp(player.x, -arenaWidth + 0.1, arenaWidth - 0.1);
    player.z = clamp(player.z, -arenaLength + 0.1, arenaLength - 0.1);
}

function pushOutOfBlockers(){
    for(var i = 0; i < blockers.length; i++){
        var b = blockers[i];
        var halfX = b.sx + player.radius;
        var halfZ = b.sz + player.radius;
        var dx = player.x - b.x;
        var dz = player.z - b.z;
        if(Math.abs(dx) < halfX && Math.abs(dz) < halfZ){
            var pushX = halfX - Math.abs(dx);
            var pushZ = halfZ - Math.abs(dz);
            if(pushX < pushZ){
                player.x += dx < 0 ? -pushX : pushX;
            }else{
                player.z += dz < 0 ? -pushZ : pushZ;
            }
        }
    }
}

function pushOutOfJumpBarriers(){
    if(player.y > 0.5){
        return;
    }
    for(var i = 0; i < jumpBarriers.length; i++){
        var b = jumpBarriers[i];
        var effectiveHalfWidth = Math.max(b.sx, arenaWidth + 0.06);
        var halfX = effectiveHalfWidth + player.radius;
        var halfZ = b.sz + player.radius;
        var dx = player.x - b.x;
        var dz = player.z - b.z;
        if(Math.abs(dx) < halfX && Math.abs(dz) < halfZ){
            var pushX = halfX - Math.abs(dx);
            var pushZ = halfZ - Math.abs(dz);
            if(pushX < pushZ){
                player.x += dx < 0 ? -pushX : pushX;
            }else{
                player.z += dz < 0 ? -pushZ : pushZ;
            }
        }
    }
}

function checkCrystalCollection(){
    for(var i = 0; i < crystals.length; i++){
        var c = crystals[i];
        if(c.collected){
            continue;
        }
        if(distance2D(player.x, player.z, c.x, c.z) < 0.62){
            c.collected = true;
            game.collected += 1;
            game.feedback = text().collectFeedback;
            game.messageTimer = 0.9;
        }
    }
}

function checkHazards(){
    if(player.invincible > 0){
        return;
    }
    for(var i = 0; i < hazards.length; i++){
        var h = hazards[i];
        if(Math.abs(player.x - h.x) < h.sx + player.radius &&
           Math.abs(player.z - h.z) < h.sz + player.radius){
            player.hp -= 1;
            player.invincible = 1.2;
            game.feedback = text().hazardFeedback;
            game.messageTimer = 1.0;
            flashEl.style.opacity = "1";
            setTimeout(function(){ flashEl.style.opacity = "0"; }, 100);
            if(player.hp <= 0){
                endGame(false, text().hpZero);
            }
            return;
        }
    }
}

function checkMovingHazards(){
    if(player.invincible > 0){
        return;
    }
    for(var i = 0; i < movingHazards.length; i++){
        var h = getMovingHazardPosition(movingHazards[i]);
        var hitHorizontally =
            Math.abs(player.x - h.x) < movingHazards[i].sx * 0.72 &&
            Math.abs(player.z - h.z) < movingHazards[i].sz * 0.55;
        if(hitHorizontally && player.y < 0.72){
            player.hp -= 1;
            player.invincible = 1.2;
            game.feedback = text().laserFeedback;
            game.messageTimer = 1.0;
            flashEl.style.opacity = "1";
            setTimeout(function(){ flashEl.style.opacity = "0"; }, 100);
            if(player.hp <= 0){
                endGame(false, text().hpZero);
            }
            return;
        }
    }
}

function checkFloorHazards(){
    if(player.invincible > 0 || player.y > 0.18){
        return;
    }
    for(var i = 0; i < floorHazards.length; i++){
        var tile = floorHazards[i];
        if(getFloorHazardState(tile) !== "danger"){
            continue;
        }
        if(Math.abs(player.x - tile.x) < tile.sx * 0.96 &&
           Math.abs(player.z - tile.z) < tile.sz * 0.96){
            player.hp -= 1;
            player.invincible = 1.2;
            game.feedback = text().floorFeedback;
            game.messageTimer = 1.0;
            flashEl.style.opacity = "1";
            setTimeout(function(){ flashEl.style.opacity = "0"; }, 100);
            if(player.hp <= 0){
                endGame(false, text().hpZero);
            }
            return;
        }
    }
}

function checkPortal(){
    if(game.collected < crystals.length){
        return;
    }
    if(distance2D(player.x, player.z, portal.x, portal.z) < portal.radius + player.radius){
        endGame(true, text().portalOpened);
    }
}

function endGame(won, detail){
    var t = text();
    game.state = won ? "won" : "lost";
    messageEl.style.display = "grid";
    messageEl.innerHTML =
        "<div class='message-card'>" +
        "<strong>" + (won ? t.win : t.lose) + "</strong>" +
        "<p>" + detail + "</p>" +
        "<div class='grid'>" +
        "<div class='item'>" + t.crystals + "<br>" + game.collected + " / " + crystals.length + "</div>" +
        "<div class='item'>" + t.hp + "<br>" + player.hp + " / 3</div>" +
        "<div class='item'>" + t.timeLeft + "<br>" + Math.ceil(game.timeLeft) + "s</div>" +
        "<div class='item'>" + t.cameraMode + "<br>" + (cameraMode === "third" ? t.third : t.first) + "</div>" +
        "</div>" +
        "<p class='prompt'>" + t.restart + "</p>" +
        "</div>";
}

function resetGameState(){
    player.x = 0;
    player.z = startZ;
    player.yaw = 180;
    player.pitch = -6;
    cameraYaw = 180;
    player.hp = 3;
    player.y = 0;
    player.verticalSpeed = 0;
    player.grounded = true;
    player.invincible = 0;
    game.state = "playing";
    game.timeLeft = game.totalTime;
    game.collected = 0;
    game.feedback = "";
    game.messageTimer = 0;
    randomizeFloorHazards();
    for(var i = 0; i < crystals.length; i++){
        crystals[i].collected = false;
    }
}

function startGame(){
    resetGameState();
    game.state = "playing";
    gameStartedAt = performance.now();
    messageEl.style.display = "none";
}

function restartGame(){
    if(game.state === "start"){
        startGame();
        return;
    }
    startGame();
}

function showStartScreen(){
    var t = text();
    updateHud();
    messageEl.style.display = "grid";
    messageEl.innerHTML =
        "<div class='message-card'>" +
        "<h1>" + t.title + "</h1>" +
        "<p>" + t.intro + "</p>" +
        "<div class='language-row' aria-label='" + t.languagePrompt + "'>" +
        "<button id='langZh' class='" + (language === "zh" ? "active" : "") + "'>中文</button>" +
        "<button id='langEn' class='" + (language === "en" ? "active" : "") + "'>English</button>" +
        "</div>" +
        "<div class='grid'>" +
        "<div class='item'>" + t.move + "<br>" + t.moveValue + "</div>" +
        "<div class='item'>" + t.jump + "<br>" + t.jumpValue + "</div>" +
        "<div class='item'>" + t.camera + "<br>" + t.cameraValue + "</div>" +
        "<div class='item'>" + t.view + "<br>" + t.viewValue + "</div>" +
        "<div class='item'>" + t.danger + "<br>" + t.dangerValue + "</div>" +
        "</div>" +
        "<p class='prompt'>" + t.startPrompt + "</p>" +
        "</div>";
    document.getElementById("langZh").onclick = function(ev){
        ev.stopPropagation();
        setLanguage("zh");
    };
    document.getElementById("langEn").onclick = function(ev){
        ev.stopPropagation();
        setLanguage("en");
    };
}

function updateHud(){
    var t = text();
    if(game.state === "start"){
        hudEl.innerHTML =
            t.objective + crystals.length + t.crystalsWord + "<br>" +
            t.avoid + "<br>" +
            t.portalGoal + "<br>" +
            t.pressStart;
        return;
    }
    hudEl.innerHTML =
        t.crystals + ": " + game.collected + " / " + crystals.length + "<br>" +
        t.hp + ": " + player.hp + " / 3<br>" +
        t.time + ": " + Math.ceil(game.timeLeft) + "s<br>" +
        t.cameraMode + ": " + (cameraMode === "third" ? t.third : t.first) +
        (game.feedback ? "<br>" + game.feedback : "");
}

function text(){
    return TEXT[language];
}

function setLanguage(nextLanguage){
    language = nextLanguage;
    if(game.state === "start"){
        showStartScreen();
    }else{
        updateHud();
    }
}

function draw(){
    var camera = getCamera();
    var aspect = canvas.width / canvas.height;
    var vp = makeViewProjection(camera, aspect, 60, 0.1, 100);
    var lightVP = makeLightViewProjection();

    renderShadowMap(lightVP);
    renderDynamicCubemap();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawSkyboxFromCamera(camera, aspect, 60);
    renderScene(vp, camera, lightVP, true, true);
}

function renderShadowMap(lightVP){
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
    gl.viewport(0, 0, shadowSize, shadowSize);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(shadowProgram);
    drawSceneObjectsForShadow(lightVP);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function renderDynamicCubemap(){
    var dirs = [
        [1, 0, 0], [-1, 0, 0], [0, 1, 0],
        [0, -1, 0], [0, 0, 1], [0, 0, -1]
    ];
    var ups = [
        [0, -1, 0], [0, -1, 0], [0, 0, 1],
        [0, 0, -1], [0, -1, 0], [0, -1, 0]
    ];
    var lightVP = makeLightViewProjection();
    var camera = { x: portal.x, y: portal.y, z: portal.z };

    gl.bindFramebuffer(gl.FRAMEBUFFER, dynamicCubeFbo);
    gl.viewport(0, 0, cubeSize, cubeSize);
    for(var i = 0; i < 6; i++){
        gl.framebufferTexture2D(
            gl.FRAMEBUFFER,
            gl.COLOR_ATTACHMENT0,
            gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
            dynamicCubeFbo.texture,
            0
        );
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        var vp = new Matrix4();
        vp.setPerspective(90, 1, 0.1, 80);
        vp.lookAt(
            camera.x, camera.y, camera.z,
            camera.x + dirs[i][0], camera.y + dirs[i][1], camera.z + dirs[i][2],
            ups[i][0], ups[i][1], ups[i][2]
        );
        drawSkyboxFromDirection(dirs[i], ups[i], 1, 90);
        renderScene(vp, camera, lightVP, false, false);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function renderScene(vp, camera, lightVP, includeReflection, useShadow){
    drawGround(vp, camera, lightVP, useShadow);
    drawFloorHazards(vp, camera, lightVP, useShadow);
    drawArenaWalls(vp, camera, lightVP, useShadow);
    drawBlockers(vp, camera, lightVP, useShadow);
    drawPlayer(vp, camera, lightVP, useShadow);
    drawCrystals(vp, camera, lightVP, useShadow);
    drawHazards(vp, camera, lightVP, useShadow);
    drawPortalBase(vp, camera, lightVP, useShadow);
    if(includeReflection){
        drawReflectivePortal(vp, camera);
    }
}

function drawSceneObjectsForShadow(lightVP){
    drawShadowObject(groundObj, makeGroundMatrix(), lightVP);
    for(var w = 0; w < 4; w++){
        drawShadowObject(cubeObj, makeWallMatrix(w), lightVP);
    }
    for(var b = 0; b < blockers.length; b++){
        drawShadowObject(cubeObj, makeBlockerMatrix(blockers[b]), lightVP);
    }
    for(var jb = 0; jb < jumpBarriers.length; jb++){
        drawShadowObject(cubeObj, makeJumpBarrierMatrix(jumpBarriers[jb]), lightVP);
    }
    for(var fh = 0; fh < floorHazards.length; fh++){
        if(getFloorHazardState(floorHazards[fh]) !== "safe"){
            drawShadowObject(cubeObj, makeFloorHazardMatrix(floorHazards[fh]), lightVP);
        }
    }
    drawShadowObject(playerObj, makePlayerMatrix(), lightVP);
    for(var i = 0; i < crystals.length; i++){
        if(!crystals[i].collected){
            drawShadowObject(sphereObj, makeCrystalMatrix(crystals[i]), lightVP);
        }
    }
    for(var h = 0; h < hazards.length; h++){
        drawShadowObject(cubeObj, makeHazardMatrix(hazards[h]), lightVP);
    }
    for(var mh = 0; mh < movingHazards.length; mh++){
        drawShadowObject(cubeObj, makeMovingHazardMatrix(movingHazards[mh]), lightVP);
    }
    drawShadowObject(cubeObj, makePortalBaseMatrix(), lightVP);
    drawShadowObject(sphereObj, makePortalSphereMatrix(), lightVP);
}

function drawGround(vp, camera, lightVP, useShadow){
    drawLitObject(groundObj, makeGroundMatrix(), vp, camera, lightVP, {
        color: [0.82, 0.95, 1.0],
        ka: 0.22, kd: 0.78, ks: 0.2, shininess: 14,
        texture: groundTexture,
        useShadow: useShadow
    });
}

function drawPlayer(vp, camera, lightVP, useShadow){
    var blink = player.invincible > 0 && Math.floor(player.invincible * 12) % 2 === 0;
    drawLitObject(playerObj, makePlayerMatrix(), vp, camera, lightVP, {
        color: blink ? [1.0, 0.35, 0.35] : [0.25, 0.55, 1.0],
        ka: 0.2, kd: 0.72, ks: 0.65, shininess: 28,
        useShadow: useShadow
    });
}

function drawFloorHazards(vp, camera, lightVP, useShadow){
    for(var i = 0; i < floorHazards.length; i++){
        var tile = floorHazards[i];
        var state = getFloorHazardState(tile);
        if(state === "safe"){
            continue;
        }
        var pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.012 + tile.phase);
        var color = state === "warning" ?
            [1.0, 0.58 + pulse * 0.18, 0.06] :
            [1.0, 0.04 + pulse * 0.12, 0.04];
        drawLitObject(cubeObj, makeFloorHazardMatrix(tile), vp, camera, lightVP, {
            color: color,
            ka: state === "warning" ? 0.55 : 0.76,
            kd: 0.78, ks: 0.9, shininess: 38,
            useShadow: useShadow
        });
    }
}

function drawArenaWalls(vp, camera, lightVP, useShadow){
    for(var i = 0; i < 4; i++){
        drawLitObject(cubeObj, makeWallMatrix(i), vp, camera, lightVP, {
            color: [0.18, 0.35, 0.5],
            ka: 0.25, kd: 0.68, ks: 0.35, shininess: 20,
            useShadow: useShadow
        });
    }
}

function drawBlockers(vp, camera, lightVP, useShadow){
    for(var i = 0; i < blockers.length; i++){
        drawLitObject(cubeObj, makeBlockerMatrix(blockers[i]), vp, camera, lightVP, {
            color: [0.22, 0.48, 0.62],
            ka: 0.22, kd: 0.7, ks: 0.32, shininess: 18,
            useShadow: useShadow
        });
    }
    for(var b = 0; b < jumpBarriers.length; b++){
        drawLitObject(cubeObj, makeJumpBarrierMatrix(jumpBarriers[b]), vp, camera, lightVP, {
            color: [0.25, 1.0, 0.85],
            ka: 0.34, kd: 0.64, ks: 0.8, shininess: 34,
            useShadow: useShadow
        });
    }
}

function drawCrystals(vp, camera, lightVP, useShadow){
    for(var i = 0; i < crystals.length; i++){
        var c = crystals[i];
        if(c.collected){
            continue;
        }
        drawLitObject(sphereObj, makeCrystalMatrix(c), vp, camera, lightVP, {
            color: [0.35, 1.0, 0.92],
            ka: 0.25, kd: 0.55, ks: 1.0, shininess: 42,
            useShadow: useShadow
        });
    }
}

function drawHazards(vp, camera, lightVP, useShadow){
    for(var i = 0; i < hazards.length; i++){
        drawLitObject(cubeObj, makeHazardMatrix(hazards[i]), vp, camera, lightVP, {
            color: [1.0, 0.16, 0.18],
            ka: 0.24, kd: 0.68, ks: 0.7, shininess: 24,
            useShadow: useShadow
        });
    }
    for(var h = 0; h < movingHazards.length; h++){
        drawLitObject(cubeObj, makeMovingHazardMatrix(movingHazards[h]), vp, camera, lightVP, {
            color: [1.0, 0.05, 0.18],
            ka: 0.68, kd: 0.8, ks: 1.0, shininess: 48,
            useShadow: useShadow
        });
    }
}

function drawPortalBase(vp, camera, lightVP, useShadow){
    drawLitObject(cubeObj, makePortalBaseMatrix(), vp, camera, lightVP, {
        color: game.collected === crystals.length ? [0.6, 1.0, 0.9] : [0.28, 0.38, 0.55],
        ka: 0.25, kd: 0.64, ks: 0.8, shininess: 30,
        useShadow: useShadow
    });
}

function drawReflectivePortal(vp, camera){
    gl.useProgram(reflectProgram);
    var model = makePortalSphereMatrix();
    var mvp = new Matrix4(vp);
    var normal = new Matrix4();
    mvp.multiply(model);
    normal.setInverseOf(model);
    normal.transpose();

    gl.uniformMatrix4fv(reflectProgram.u_MvpMatrix, false, mvp.elements);
    gl.uniformMatrix4fv(reflectProgram.u_modelMatrix, false, model.elements);
    gl.uniformMatrix4fv(reflectProgram.u_normalMatrix, false, normal.elements);
    gl.uniform3f(reflectProgram.u_ViewPosition, camera.x, camera.y, camera.z);
    gl.uniform3f(reflectProgram.u_Tint, 0.16, 0.9, 1.0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, dynamicCubeFbo.texture);
    gl.uniform1i(reflectProgram.u_envCubeMap, 0);
    drawObjectBuffers(reflectProgram, sphereObj, false);
}

function drawLitObject(obj, model, vp, camera, lightVP, material){
    gl.useProgram(litProgram);
    var mvp = new Matrix4(vp);
    var normal = new Matrix4();
    var lightMvp = new Matrix4(lightVP);
    mvp.multiply(model);
    lightMvp.multiply(model);
    normal.setInverseOf(model);
    normal.transpose();

    gl.uniformMatrix4fv(litProgram.u_MvpMatrix, false, mvp.elements);
    gl.uniformMatrix4fv(litProgram.u_modelMatrix, false, model.elements);
    gl.uniformMatrix4fv(litProgram.u_normalMatrix, false, normal.elements);
    gl.uniformMatrix4fv(litProgram.u_MvpMatrixOfLight, false, lightMvp.elements);
    gl.uniform3f(litProgram.u_LightPosition, light.x, light.y, light.z);
    gl.uniform3f(litProgram.u_ViewPosition, camera.x, camera.y, camera.z);
    gl.uniform3f(litProgram.u_Color, material.color[0], material.color[1], material.color[2]);
    gl.uniform1f(litProgram.u_Ka, material.ka);
    gl.uniform1f(litProgram.u_Kd, material.kd);
    gl.uniform1f(litProgram.u_Ks, material.ks);
    gl.uniform1f(litProgram.u_shininess, material.shininess);
    gl.uniform1i(litProgram.u_useShadow, material.useShadow ? 1 : 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, shadowFbo.texture);
    gl.uniform1i(litProgram.u_ShadowMap, 1);

    if(material.texture){
        gl.uniform1i(litProgram.u_useTexture, 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, material.texture);
        gl.uniform1i(litProgram.u_Sampler, 0);
    }else{
        gl.uniform1i(litProgram.u_useTexture, 0);
    }

    drawObjectBuffers(litProgram, obj, true);
}

function drawShadowObject(obj, model, lightVP){
    var mvp = new Matrix4(lightVP);
    mvp.multiply(model);
    gl.uniformMatrix4fv(shadowProgram.u_MvpMatrix, false, mvp.elements);
    for(var i = 0; i < obj.length; i++){
        initAttributeVariable(gl, shadowProgram.a_Position, obj[i].vertexBuffer);
        gl.drawArrays(gl.TRIANGLES, 0, obj[i].numVertices);
    }
}

function drawObjectBuffers(program, obj, needsTexcoord){
    for(var i = 0; i < obj.length; i++){
        initAttributeVariable(gl, program.a_Position, obj[i].vertexBuffer);
        if(program.a_Normal >= 0 && obj[i].normalBuffer){
            initAttributeVariable(gl, program.a_Normal, obj[i].normalBuffer);
        }
        if(needsTexcoord && program.a_TexCoord >= 0){
            if(obj[i].texCoordBuffer){
                initAttributeVariable(gl, program.a_TexCoord, obj[i].texCoordBuffer);
            }else{
                gl.disableVertexAttribArray(program.a_TexCoord);
                gl.vertexAttrib2f(program.a_TexCoord, 0, 0);
            }
        }
        gl.drawArrays(gl.TRIANGLES, 0, obj[i].numVertices);
    }
}

function drawSkyboxFromCamera(camera, aspect, fov){
    drawSkyboxFromDirection(
        [camera.lx - camera.x, camera.ly - camera.y, camera.lz - camera.z],
        [0, 1, 0],
        aspect,
        fov
    );
}

function drawSkyboxFromDirection(direction, up, aspect, fov){
    var projection = new Matrix4();
    var viewRotation = new Matrix4();
    var vp = new Matrix4();
    var inv = new Matrix4();
    projection.setPerspective(fov, aspect, 0.1, 100);
    viewRotation.setLookAt(0, 0, 0, direction[0], direction[1], direction[2], up[0], up[1], up[2]);
    vp.set(projection);
    vp.multiply(viewRotation);
    inv.setInverseOf(vp);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.useProgram(envProgram);
    initAttributeVariable(gl, envProgram.a_Position, quadObj[0].vertexBuffer);
    gl.uniformMatrix4fv(envProgram.u_viewDirectionProjectionInverse, false, inv.elements);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, cubeMapTex);
    gl.uniform1i(envProgram.u_envCubeMap, 0);
    gl.drawArrays(gl.TRIANGLES, 0, quadObj[0].numVertices);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
}

function makeGroundMatrix(){
    var m = new Matrix4();
    m.setIdentity();
    return m;
}

function makeWallMatrix(index){
    var m = new Matrix4();
    var wallHeight = 1.25;
    if(index === 0){
        m.setTranslate(0, wallHeight * 0.5, -arenaLength - 0.2);
        m.scale(arenaWidth * 2 + 0.8, wallHeight, 0.28);
    }else if(index === 1){
        m.setTranslate(0, wallHeight * 0.5, arenaLength + 0.2);
        m.scale(arenaWidth * 2 + 0.8, wallHeight, 0.28);
    }else if(index === 2){
        m.setTranslate(-arenaWidth - 0.2, wallHeight * 0.5, 0);
        m.scale(0.28, wallHeight, arenaLength * 2 + 0.8);
    }else{
        m.setTranslate(arenaWidth + 0.2, wallHeight * 0.5, 0);
        m.scale(0.28, wallHeight, arenaLength * 2 + 0.8);
    }
    return m;
}

function makeBlockerMatrix(b){
    var m = new Matrix4();
    m.setTranslate(b.x, 0.42, b.z);
    m.scale(b.sx, 0.84, b.sz);
    return m;
}

function makeJumpBarrierMatrix(b){
    var m = new Matrix4();
    m.setTranslate(b.x, 0.24, b.z);
    var effectiveHalfWidth = Math.max(b.sx, arenaWidth + 0.06);
    m.scale(effectiveHalfWidth, 0.48, b.sz);
    return m;
}

function makeFloorHazardMatrix(tile){
    var m = new Matrix4();
    m.setTranslate(tile.x, 0.018, tile.z);
    m.scale(tile.sx, 0.018, tile.sz);
    return m;
}

function makePlayerMatrix(){
    var m = new Matrix4();
    m.setTranslate(player.x, 0.05 + player.y, player.z);
    m.rotate(player.yaw, 0, 1, 0);
    m.scale(0.024, 0.024, 0.024);
    return m;
}

function makeCrystalMatrix(c){
    var m = new Matrix4();
    m.setTranslate(c.x, c.y + Math.sin(rotateAngle * Math.PI / 90) * 0.08, c.z);
    m.rotate(rotateAngle * 1.8, 0, 1, 0);
    m.scale(0.2, 0.42, 0.2);
    return m;
}

function makeHazardMatrix(h){
    var m = new Matrix4();
    m.setTranslate(h.x, 0.28, h.z);
    m.rotate(rotateAngle * 0.45, 0, 1, 0);
    m.scale(h.sx, 0.55, h.sz);
    return m;
}

function getMovingHazardPosition(h){
    var offset = Math.sin(performance.now() * 0.001 * h.speed + h.phase) * h.range;
    return {
        x: h.baseX + (h.axis === "x" ? offset : 0),
        z: h.baseZ + (h.axis === "z" ? offset : 0)
    };
}

function makeMovingHazardMatrix(h){
    var p = getMovingHazardPosition(h);
    var m = new Matrix4();
    m.setTranslate(p.x, 0.62, p.z);
    m.scale(h.sx, 0.08, h.sz);
    return m;
}

function makePortalBaseMatrix(){
    var m = new Matrix4();
    m.setTranslate(portal.x, 0.08, portal.z);
    m.scale(1.25, 0.16, 1.25);
    return m;
}

function makePortalSphereMatrix(){
    var m = new Matrix4();
    m.setTranslate(portal.x, portal.y, portal.z);
    m.rotate(rotateAngle, 0, 1, 0);
    m.scale(0.68, 0.68, 0.68);
    return m;
}

function getCamera(){
    var dir = getLookDirection();
    if(cameraMode === "first"){
        return {
            x: player.x,
            y: 0.9 + player.y,
            z: player.z,
            lx: player.x + dir[0],
            ly: 0.9 + player.y + dir[1],
            lz: player.z + dir[2]
        };
    }
    var flat = getFlatForward();
    var distance = 7.2;
    return {
        x: player.x - flat[0] * distance,
        y: 4.2 + player.y * 0.35,
        z: player.z - flat[2] * distance,
        lx: player.x,
        ly: 0.75,
        lz: player.z
    };
}

function getLookDirection(){
    var yaw = cameraYaw * Math.PI / 180.0;
    var pitch = player.pitch * Math.PI / 180.0;
    var x = Math.sin(yaw) * Math.cos(pitch);
    var y = Math.sin(pitch);
    var z = Math.cos(yaw) * Math.cos(pitch);
    return normalize3([x, y, z]);
}

function getFlatForward(){
    var yaw = cameraYaw * Math.PI / 180.0;
    return normalize3([Math.sin(yaw), 0, Math.cos(yaw)]);
}

function makeViewProjection(camera, aspect, fov, near, far){
    var vp = new Matrix4();
    vp.setPerspective(fov, aspect, near, far);
    vp.lookAt(camera.x, camera.y, camera.z, camera.lx, camera.ly, camera.lz, 0, 1, 0);
    return vp;
}

function makeLightViewProjection(){
    var m = new Matrix4();
    m.setPerspective(80, 1, 1, 70);
    m.lookAt(light.x, light.y, light.z, 0, 0, -2.0, 0, 1, 0);
    return m;
}

function createScreenQuad(){
    var quad = [
        -1, -1, 1, 1, -1, 1, -1, 1, 1,
        -1, 1, 1, 1, -1, 1, 1, 1, 1
    ];
    return [initVertexBufferForLaterUse(gl, quad, null, null)];
}

function createGroundPlane(){
    var width = arenaWidth;
    var length = arenaLength;
    var y = 0;
    var vertices = [
        -width, y, -length, -width, y, length, width, y, -length,
        -width, y, length, width, y, length, width, y, -length
    ];
    var normals = [
        0, 1, 0, 0, 1, 0, 0, 1, 0,
        0, 1, 0, 0, 1, 0, 0, 1, 0
    ];
    var texCoords = [
        0, 0, 0, 22, 5, 0,
        0, 22, 5, 22, 5, 0
    ];
    return [initVertexBufferForLaterUse(gl, vertices, normals, texCoords)];
}

function createPlatformTexture(gl){
    var c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    var ctx = c.getContext("2d");
    var bg = ctx.createLinearGradient(0, 0, 0, 256);
    bg.addColorStop(0, "#101827");
    bg.addColorStop(0.5, "#16263a");
    bg.addColorStop(1, "#0b111d");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "rgba(93, 232, 255, 0.18)";
    ctx.fillRect(12, 0, 8, 256);
    ctx.fillRect(236, 0, 8, 256);
    ctx.fillStyle = "rgba(93, 232, 255, 0.26)";
    ctx.fillRect(124, 0, 8, 256);
    ctx.strokeStyle = "rgba(130, 230, 255, 0.34)";
    ctx.lineWidth = 1;
    for(var i = 0; i < 9; i++){
        var y = i * 32;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(256, y + 18);
        ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.strokeRect(18, 10, 220, 236);
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return texture;
}

function initProceduralCubeTexture(gl){
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
    var targets = [
        gl.TEXTURE_CUBE_MAP_POSITIVE_X,
        gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
        gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
        gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
        gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
        gl.TEXTURE_CUBE_MAP_NEGATIVE_Z
    ];
    for(var i = 0; i < targets.length; i++){
        gl.texImage2D(targets[i], 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, createSkyFace(i));
    }
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
}

function createSkyFace(faceIndex){
    var c = document.createElement("canvas");
    c.width = 512;
    c.height = 512;
    var ctx = c.getContext("2d");
    var g = ctx.createLinearGradient(0, 0, 0, 512);
    var topColors = ["#071426", "#08172a", "#0a1830", "#050914", "#071225", "#060b18"];
    var bottomColors = ["#102b46", "#0d253d", "#122e4a", "#0a1224", "#0f2943", "#0b1428"];
    g.addColorStop(0, topColors[faceIndex]);
    g.addColorStop(1, bottomColors[faceIndex]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);

    ctx.strokeStyle = "rgba(95, 210, 255, 0.12)";
    ctx.lineWidth = 1;
    for(var i = -512; i < 1024; i += 64){
        ctx.beginPath();
        ctx.moveTo(i, 512);
        ctx.lineTo(i + 340, 0);
        ctx.stroke();
    }

    var stars = 70;
    for(var s = 0; s < stars; s++){
        var x = pseudoRandom(faceIndex * 200 + s * 17) * 512;
        var y = pseudoRandom(faceIndex * 300 + s * 31) * 360;
        var r = 0.8 + pseudoRandom(faceIndex * 400 + s * 43) * 1.4;
        ctx.fillStyle = "rgba(210, 245, 255, " + (0.35 + pseudoRandom(s + faceIndex) * 0.55) + ")";
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.fillStyle = "rgba(85, 235, 255, 0.18)";
    ctx.beginPath();
    ctx.arc(380 - faceIndex * 18, 140 + faceIndex * 8, 56, 0, Math.PI * 2);
    ctx.fill();
    return c;
}

function pseudoRandom(seed){
    var x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x);
}

function init2DFrameBuffer(gl, width, height){
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var depthBuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);
    fbo.texture = texture;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fbo;
}

function initCubeFrameBuffer(gl, size){
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    for(var i = 0; i < 6; i++){
        gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    var depthBuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);
    fbo.texture = texture;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fbo;
}

async function loadOBJtoCreateVBO(objFile){
    var objComponents = [];
    var response = await fetch(objFile);
    var text = await response.text();
    var obj = parseOBJ(text);
    for(var i = 0; i < obj.geometries.length; i++){
        objComponents.push(initVertexBufferForLaterUse(
            gl,
            obj.geometries[i].data.position,
            obj.geometries[i].data.normal,
            obj.geometries[i].data.texcoord
        ));
    }
    return objComponents;
}

function initVertexBufferForLaterUse(gl, vertices, normals, texCoords){
    var o = {};
    o.vertexBuffer = initArrayBufferForLaterUse(gl, new Float32Array(vertices), 3, gl.FLOAT);
    if(normals){
        o.normalBuffer = initArrayBufferForLaterUse(gl, new Float32Array(normals), 3, gl.FLOAT);
    }
    if(texCoords){
        o.texCoordBuffer = initArrayBufferForLaterUse(gl, new Float32Array(texCoords), 2, gl.FLOAT);
    }
    o.numVertices = vertices.length / 3;
    return o;
}

function initArrayBufferForLaterUse(gl, data, num, type){
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    buffer.num = num;
    buffer.type = type;
    return buffer;
}

function initAttributeVariable(gl, a_attribute, buffer){
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.vertexAttribPointer(a_attribute, buffer.num, buffer.type, false, 0, 0);
    gl.enableVertexAttribArray(a_attribute);
}

function compileShader(gl, vShaderText, fShaderText){
    var vertexShader = gl.createShader(gl.VERTEX_SHADER);
    var fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(vertexShader, vShaderText);
    gl.shaderSource(fragmentShader, fShaderText);
    gl.compileShader(vertexShader);
    if(!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)){
        console.log(gl.getShaderInfoLog(vertexShader));
    }
    gl.compileShader(fragmentShader);
    if(!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)){
        console.log(gl.getShaderInfoLog(fragmentShader));
    }
    var program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program, gl.LINK_STATUS)){
        alert(gl.getProgramInfoLog(program));
    }
    return program;
}

function parseOBJ(text) {
    const objPositions = [[0, 0, 0]];
    const objTexcoords = [[0, 0]];
    const objNormals = [[0, 0, 0]];
    const objVertexData = [objPositions, objTexcoords, objNormals];
    let webglVertexData = [[], [], []];
    const materialLibs = [];
    const geometries = [];
    let geometry;
    let groups = ["default"];
    let material = "default";
    let object = "default";
    const noop = () => {};

    function newGeometry() {
        if (geometry && geometry.data.position.length) {
            geometry = undefined;
        }
    }
    function setGeometry() {
        if (!geometry) {
            const position = [];
            const texcoord = [];
            const normal = [];
            webglVertexData = [position, texcoord, normal];
            geometry = {
                object: object,
                groups: groups,
                material: material,
                data: { position: position, texcoord: texcoord, normal: normal }
            };
            geometries.push(geometry);
        }
    }
    function addVertex(vert) {
        const ptn = vert.split("/");
        ptn.forEach((objIndexStr, i) => {
            if (!objIndexStr) return;
            const objIndex = parseInt(objIndexStr);
            const index = objIndex + (objIndex >= 0 ? 0 : objVertexData[i].length);
            webglVertexData[i].push(...objVertexData[i][index]);
        });
    }
    const keywords = {
        v(parts) { objPositions.push(parts.map(parseFloat)); },
        vn(parts) { objNormals.push(parts.map(parseFloat)); },
        vt(parts) { objTexcoords.push(parts.map(parseFloat)); },
        f(parts) {
            setGeometry();
            const numTriangles = parts.length - 2;
            for (let tri = 0; tri < numTriangles; ++tri) {
                addVertex(parts[0]);
                addVertex(parts[tri + 1]);
                addVertex(parts[tri + 2]);
            }
        },
        s: noop,
        mtllib(parts, unparsedArgs) { materialLibs.push(unparsedArgs); },
        usemtl(parts, unparsedArgs) { material = unparsedArgs; newGeometry(); },
        g(parts) { groups = parts; newGeometry(); },
        o(parts, unparsedArgs) { object = unparsedArgs; newGeometry(); }
    };
    const keywordRE = /(\w*)(?: )*(.*)/;
    const lines = text.split("\n");
    for (let lineNo = 0; lineNo < lines.length; ++lineNo) {
        const line = lines[lineNo].trim();
        if (line === "" || line.startsWith("#")) continue;
        const m = keywordRE.exec(line);
        if (!m) continue;
        const [, keyword, unparsedArgs] = m;
        const parts = line.split(/\s+/).slice(1);
        const handler = keywords[keyword];
        if (!handler) continue;
        handler(parts, unparsedArgs);
    }
    for (const geometry of geometries) {
        geometry.data = Object.fromEntries(
            Object.entries(geometry.data).filter(([, array]) => array.length > 0)
        );
    }
    return { geometries: geometries, materialLibs: materialLibs };
}

function keyDown(ev){
    var key = ev.key.toLowerCase();
    keys[key] = true;
    if(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].indexOf(key) >= 0){
        ev.preventDefault();
    }
    if(key === "v"){
        cameraMode = cameraMode === "third" ? "first" : "third";
    }
    if(key === "l" && game.state === "start"){
        setLanguage(language === "zh" ? "en" : "zh");
    }
    if(key === "enter" && game.state === "start"){
        startGame();
    }
    if(key === "r"){
        restartGame();
    }
}

function keyUp(ev){
    keys[ev.key.toLowerCase()] = false;
}

function mouseDown(ev){
    var rect = ev.target.getBoundingClientRect();
    if(rect.left <= ev.clientX && ev.clientX < rect.right && rect.top <= ev.clientY && ev.clientY < rect.bottom){
        mouseLastX = ev.clientX;
        mouseLastY = ev.clientY;
        mouseDragging = true;
    }
}

function mouseMove(ev){
    if(mouseDragging){
        var dx = ev.clientX - mouseLastX;
        var dy = ev.clientY - mouseLastY;
        cameraYaw += dx * 0.22;
        player.pitch = clamp(player.pitch - dy * 0.18, -40, 35);
    }
    mouseLastX = ev.clientX;
    mouseLastY = ev.clientY;
}

function mouseUp(){
    mouseDragging = false;
}

function distance2D(x1, z1, x2, z2){
    var dx = x1 - x2;
    var dz = z1 - z2;
    return Math.sqrt(dx * dx + dz * dz);
}

function normalize3(v){
    var len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if(len <= 0.00001){
        return [0, 0, -1];
    }
    return [v[0] / len, v[1] / len, v[2] / len];
}

function clamp(v, min, max){
    return Math.max(min, Math.min(max, v));
}

function randomRange(min, max){
    return min + Math.random() * (max - min);
}

function resizeCanvasToDisplaySize(){
    var width = Math.max(1, Math.floor(canvas.clientWidth * window.devicePixelRatio));
    var height = Math.max(1, Math.floor(canvas.clientHeight * window.devicePixelRatio));
    if(canvas.width !== width || canvas.height !== height){
        canvas.width = width;
        canvas.height = height;
    }
}
