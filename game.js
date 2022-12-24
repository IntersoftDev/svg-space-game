//Copyright © 2020, Michael L. Eberhart, All Rights Reserved

// Globals : note that function initGameState() truly sets/resets many initial/new-game values!
let isFirstRun = true;
let gameNumber = 0; //use for ignoring async promise resolves that may span games.

//Global audio-context; cannot set here due to policies (see: https://developers.google.com/web/updates/2017/09/autoplay-policy-changes#webaudio)
let audioCtx = undefined;

//requestAnimationFrame() reference
let rAF;

//localStorage won't be available unless game is hosted (i.e., filesystem-run via file://... will errors)
var scoreStorage;
try {
    scoreStorage = window.localStorage;
} catch(e) {
    scoreStorage = undefined;
}

//Make sure CSS svg entries match these
const ScreenWidth  = 900;
const ScreenHeight = 600;
const respawnPointX = ScreenWidth / 2;
const respawnPointY = ScreenHeight / 2;

//SVG element refs
const svgns = "http://www.w3.org/2000/svg";  //SVG Namespace
const svgRef        = document.getElementsByTagName("svg")[0];
const svgDocument   = svgRef.ownerDocument;
const textScore     = document.getElementById("score");
const textHighScore = document.getElementById("highScore");
const textLevel     = document.getElementById("level");
const shipSymbol    = document.getElementById("spaceship");
const polyShipFlame = document.getElementById("shipsymflame");
const circShipShield= document.getElementById("shipShield");
const rectShieldPct = document.getElementById("shieldPctBar");
const textGameIntro = document.getElementById("introBlockText");
const textGameOver  = document.getElementById("gameOver");
const movingObjInsertPoint = document.getElementById("movingObjInsertPoint");
const liFeIndicator1= document.getElementById("livesRemaining1");
const liFeIndicator2= document.getElementById("livesRemaining2");
const liFeIndicator3= document.getElementById("livesRemaining3");
const liFeIndicator4= document.getElementById("livesRemaining4");
const warpIndicator1= document.getElementById("warp1");
const warpIndicator2= document.getElementById("warp2");
const warpIndicator3= document.getElementById("warp3");

//Game Pad (Xbox 360 Controller) support
let gamePad = undefined;
let priorGamePad = undefined; //stores prior gamepad button/axes states for change-detection
let gamepadTimestamp = 0;
const gamepadLeftTopShoulder = 4; //the button above left trigger
const gamepadTriggerL = 6;
const gamepadTriggerR = 7;
const gamepadAxisX    = 2;
const gamepadAxisY    = 3;
const gamepadStickMin = .7; //sensitivity (in theory); haw far analog stick engaged before event

//Keys used
const KEY_SPACE = 32; //shoot
const KEY_LEFT  = 37;
const KEY_UP    = 38;
const KEY_RIGHT = 39;
const KEY_DOWN  = 40;
const KEY_N     = "KeyN"; //New Game (to accept uppercase 78 or lowercase 110, must use this form)
const KEY_S     = 83; //Shield
const KEY_W     = 87; //Warp into Hyperspace

// Keystate
let keyUpPressed    = false;
let keyDownPressed  = false;
let keyLeftPressed  = false;
let keyRightPressed = false;
let keyShootPressed = false;
let readyToShoot    = true;

// Game State and Levels
let score = 0;
let bonusShipAwards =[];

const levelDifficultyIncRock = 0.1; //10% tougher (from baseline) each level (speed increase)
const levelDifficultyIncUfo = 0.1;  //10% tougher
const introTime = 1000; //ms to display intro/level change
let currentLevel = 0;
let levelInitializeState = false;
let shipRespawning = false;

//Player ship
let ship = undefined; //ref to our spaceship object instance
let numLivesRemaining = 4;
let maxPlayerLives = 5;
const shipSize = 12;  //radius from ship-center
const friction = .995;
let shieldedModeActive = false;
let maxShieldTime = 12000; //This will allow approx 15 seconds per ship (at level 1) down to 6 secs per level (drains faster)
const shieldBonusTimePerLevel = 1500;
const shieldRectMax = 50; //width, in pixels, of rect to show strength
let shieldUsePace = 9; //higher value drains shield quicker
const maxWarpsAvail = 3;  //per-ship
const maxPlayerVelocity = 12;
//Player Movement state; TODO/NOTE: ES allows variable names like ΔX (unicode Delta) if desired.
let deltaX = 0;
let deltaY = 0;

let ufos = []; //array of Ufo objects
let nextUfoSpawnTime = 0;

let shots = []; //array of Shot objects; both Player and Ufo shots
const shotRadius = 3; //Make sure CSS .ship-shot r value matches
const ufoShotSpeed = 3;
const playerShotSpeed = 8;

//the space-debris we need to shoot
let rocks = []; //Array of Rock objects; shapes currently shown on the screen.
const rockRadiusL = 42;
const rockRadiusM = 25;
const rockRadiusS = 14;

//Structure to store precomputed Rock object data used to render various sizes
class RockData {
    path;
    centroidOffset;
    radius;
    speed;
}


//Abstract base class
class movingObject {

    /*
      At any given time, there are (potentially) multiple instances of the Classes
      Rocks, UFOs, and Shots (from player Ship and/or from UFOs) on the screen,
      each of which can have their position updated and/or be removed from the screen.

      Rocks and UFOs remain in motion until destroyed.
      Shots remain in motion over various main game loop cycles until:
        1) shot has traveled its max-range across screen
        2) shot has impacted a rock, ship, ufo.
      Visual "destruction" is handled via CSS Animation.

      Each movingObject subclass implements the following:
         (property) queuedMoves : decrement until 0, then destroy/remove obj from game
         (method)   motionProcessing()
         (method)   destroy()     
     */
    static processQueuedMotion(objects) {
        //Remove any objects with no moves remaining, otherwise render them
        for (let i = 0; i < objects.length; i++) {
            if (objects[i].queuedMoves <= 0) {
                objects[i].destroy();
                objects.splice(i, 1); //delete object refs
            } else {
                objects[i].motionProcessing();
            }
        }
    }


    screenWrap(pos, margin) {
        if (margin === undefined) { margin = 0; }
        if ((pos.x + margin) > ScreenWidth) {
            pos.x = 0;
        }
        if (pos.x < 0) {
            pos.x = ScreenWidth - margin * 2;
        }
        if ((pos.y + margin) > ScreenHeight) {
            pos.y = 0;
        }
        if (pos.y < 0) {
            pos.y = ScreenHeight - margin * 2;
        }
        return pos;
    }
} //class movingObject


class Rock extends movingObject {

    constructor(rockData, initialPosition) {
        super();
        this.rockData = rockData;

        this.element = undefined;
        this.rotation = 0;
        this.queuedMoves = 1; //Remains 1 (i.e., continue moving) until rock is shot, then 0
        this.position  = new Vec2d(0,0, 0,0);
        this.radiusLetter = "S"; //default to Small type -- NOTE: BRITTLE CODE (ties to SVG Use IDs)
        this.destroyedByPlayer = true; //default to player Ship

        const rotationDirection = ((Math.random() > .5) ? 1 : -1 );
        switch (this.rockData.radius) {
            case rockRadiusL :
                this.rockData.speed = .75 + Math.min(levelDifficultyIncRock * currentLevel, .75);
                this.rotationIncrement = .08 * rotationDirection;
                this.radiusLetter = "L";
                break;
            case rockRadiusM :
                this.rockData.speed = 1 + Math.min(levelDifficultyIncRock * currentLevel, 1);
                this.rotationIncrement = 1.2 * rotationDirection;
                this.radiusLetter = "M";
                break;
            default:
                this.rockData.speed = 1.5 + Math.min(levelDifficultyIncRock * currentLevel, 1.25);
                this.rotationIncrement = 4 * rotationDirection;
        }

        const direction = Vec2d.randomizeDirection(new Vec2d(0,0, 0,0));

        //Motion vector: how much to move in X/Y directions each motion cycle.
        //Note: ensure minimum movement to prevent a rock "hovering", especially in respawn location
        this.motionVec = Vec2d.sMult(direction, this.rockData.speed);
        this.motionVec.x += ((this.motionVec.x >= 0) ? .1 : -.1);
        this.motionVec.y += ((this.motionVec.y >= 0) ? .1 : -.1);

        //Place new LARGE rocks randomly, but not "right on top of" the ship (within 5*radius margin) or its center-of-screen respawn point
        //Note: med/small rocks created when split by shooting have immutable initial pos)
        if (initialPosition === undefined) {
            while (true) {
                this.position.x = Math.floor(Math.random()*ScreenWidth);
                this.position.y = Math.floor(Math.random()*ScreenHeight);
                if (ship === undefined) {
                    if (!this.hitTest(respawnPointX + shipSize, respawnPointY + shipSize, shipSize * 5)) break;
                } else {
                    if (!this.hitTest(ship.center.x, ship.center.y, shipSize * 5)) break;
                }
            }
        } else {
            this.position = initialPosition;
        }

        //Create Group obj to hold: 1) the space rock, and 2) the dust/gravity-cloud around it
        this.element = svgDocument.createElementNS(svgns, "g");

        this.rockCloud = svgDocument.createElementNS(svgns, "use");
        this.rockCloud.setAttributeNS(null, "href", "#rockCloud" + this.radiusLetter); //NOTE: BRITTLE
        this.element.appendChild(this.rockCloud);

        this.rock = svgDocument.createElementNS(svgns, "polygon");
        this.rock.setAttributeNS(null, "class", "rock");
        this.rock.setAttributeNS(null, "points", this.rockData.path);
        this.element.appendChild(this.rock);

        svgRef.insertBefore(this.element, movingObjInsertPoint);
    } //Rock.constructor


    motionProcessing() {
        this.rotation += this.rotationIncrement;
        this.position = this.position.add(this.motionVec);

        // Do screen wrapping
        this.position = this.screenWrap(this.position, this.rockData.radius);

        this.element.setAttributeNS(null, "transform", `rotate(${toStringRoundCent(this.rotation)} ${toStringRoundCent(this.position.x + this.rockData.centroidOffset.x)} ${toStringRoundCent(this.position.y + this.rockData.centroidOffset.y)})
         translate(${toStringRoundCent(this.position.x)} ${toStringRoundCent(this.position.y)})`);

        if ((ship !== undefined) && (shieldedModeActive === false) &&
            (this.hitTest(ship.center.x, ship.center.y, shipSize))) {
            ship.destroy();
        }

        for (let i = 0; i < shots.length; i++) {
            //Test for shots (fired from player or UFOs) hitting rock; if from UFO, do not to add to player score.
            if (this.hitTest(shots[i].position.x, shots[i].position.y, shotRadius)) {
                this.queuedMoves = 0;
                shots[i].queuedMoves = 0; //Rock was hit; this shot is done moving.
                this.destroyedByPlayer = shots[i].isPlayerShooter;
                break;
            }
        }
    } //Rock.motionProcessing


    //Rock can be hit by player Shot or player Ship and even UFO shot.
    //  r = radius of ship or shot potentially hitting the rock
    hitTest(px, py, r) {
        const centroid = this.position.add(this.rockData.centroidOffset);
        // Calculate distance from rock centroid to ship centroid
        return (getDistanceBetweenTwoPoints(centroid.x, centroid.y, px, py) < (this.rockData.radius + r));
    }


    destroy(isEndGameCleanup) {
        svgRef.removeChild(this.element);

        if (isEndGameCleanup) return;

        this.explosion = svgDocument.createElementNS(svgns, "use");
        this.explosion.setAttributeNS(null, "href", "#explodeRock" + this.radiusLetter); //NOTE: BRITTLE SVG-ref
        this.explosion.setAttributeNS(null, "x", toStringRoundCent(this.position.x));
        this.explosion.setAttributeNS(null, "y", toStringRoundCent(this.position.y));
        svgRef.insertBefore(this.explosion, movingObjInsertPoint);
        new Promise(r => explosionPromise(this.explosion, 400));

        //Create smaller rocks when breaking larger ones. Score higher for small objects.
        let childRockRadii = 0;
        switch (this.rockData.radius) {
            case rockRadiusS :
                if (this.destroyedByPlayer) UpdateScore(100);
                return; //has no smaller children
            case rockRadiusM :
                if (this.destroyedByPlayer) UpdateScore(50);
                childRockRadii = rockRadiusS;
                break;
            default:
                if (this.destroyedByPlayer) UpdateScore(20);
                childRockRadii = rockRadiusM;
        }

        //Create 2 smaller objects as needed on breakup of larger ones.
        for (let i = 0; i < 2; i++) {
            rocks.push(new Rock(getNewRockData(childRockRadii), this.position));
        }
    } //Rock.destroy

} //class Rock


class Ufo extends movingObject {

    //ufoType = L/S (large, small)
    constructor(ufoType) {
        super();

        this.queuedMoves = 1; //Remains 1 until shot (or crashed into), then 0
        this.radius = (ufoType === "L" ? 24 : 12);
        this.ufoType = ufoType;
        this.lastShotTimeMs = Date.now() + (Math.max(2000 - currentLevel * 200, 500)); //Give player time to notice
        this.lastDirChangeTimeMs = Date.now() + 2000;

        //This will be used for determining random start-point on screen as well as
        //linear trajectory.
        const direction = Vec2d.randomizeDirection(new Vec2d(0,0, 0,0));

        //choose a screen-edge to come in from
        this.position  = new Vec2d(0,0, 0,0);
        if (Math.random() > .5) {
            this.position.x = Math.abs(direction.x) * (ScreenWidth - this.radius*2);
            this.position.y = ((direction.y > 0) ? ScreenHeight - this.radius*2 : 0);
        } else {
            this.position.x = ((direction.x > 0) ? ScreenWidth - this.radius*2 : 0);
            this.position.y = Math.abs(direction.y) * (ScreenHeight - this.radius*2);
        }

        //Motion vector: how much to move in X/Y directions each motion cycle.
        //Small UFOs wil move rather quickly!
        this.ufoVelocity =  Math.min(1 + levelDifficultyIncUfo * currentLevel, 2) * (ufoType === "L" ? 1.2 : 1.5);
        this.motionVec = Vec2d.sMult(direction, -1 * this.ufoVelocity); //direct away from screen-edge we start on
        this.shotIntervalMs = (this.ufoType === "L" ? 1250 : 900) - Math.min(currentLevel * 25, 250);

        //TODO: TEST FOR PLAYER-SHIP BEFORE PLACING HERE, or allow random instant player/ufo death?
        this.element = svgDocument.createElementNS(svgns, "use");
        this.element.setAttributeNS(null, "href", "#UFO-" + ufoType); //NOTE: BRITTLE
        svgRef.insertBefore(this.element, movingObjInsertPoint);
        this.motionProcessing();
    } //Ufo constructor


    motionProcessing() {
        this.element.setAttributeNS(null, "transform", `translate(${toStringRoundCent(this.position.x)} ${toStringRoundCent(this.position.y)})`);

        // Do screen wrapping
        this.position = this.position.add(this.motionVec);
        this.position = this.screenWrap(this.position, this.radius);

        //Ship/UFO collision-test
        if ((ship !== undefined) && (!ship.destroyed) &&
            (this.didShipUfoCollide(ship.center.x, ship.center.y, shipSize))) {
            if (shieldedModeActive === false) {
                ship.destroy();
            }
            UpdateScore(this.ufoType === "L" ? 200 : 1000);
            this.destroy();
            return;
        }

        if ((ship !== undefined) && (!ship.destroyed) &&
            ((Date.now() - this.lastShotTimeMs) > this.shotIntervalMs)) {
            this.shoot();
        }

        //Mix things up a bit -- change UFO direction every so often
        if ((Date.now() - this.lastDirChangeTimeMs) > (((this.ufoType === "L") ? 6000 : 3000) - Math.min((currentLevel * 100), 2000))) {
            const newDirection = Vec2d.randomizeDirection(new Vec2d(0,0, 0,0));
            this.motionVec = Vec2d.sMult(newDirection, this.ufoVelocity);
            this.lastDirChangeTimeMs = Date.now();
        }

    } //Ufo.motionProcessing


    //UFO can be hit by player Shot or player Ship.
    //  x, y, r = x/y-position and radius of ship or shot potentially hitting UFO
    didShipUfoCollide(x, y, r) {
        return (getDistanceBetweenTwoPoints(this.position.x + this.radius, this.position.y + this.radius, x, y) < (this.radius + r));
    }

    shoot() {
        //starting point for shot
        const pos = new Vec2d();
        pos.x = this.position.x + this.radius;
        pos.y = this.position.y + this.radius;

        //Get direction as a normalized vector pointing from UFO toward player Ship
        const shotDir = new Vec2d(pos.x, pos.y, ship.center.x, ship.center.y);
        //TODO: for more difficulty, SMALL UFO could consider PlayerShip motion vec / inertia

        //refine starting point: lgUfo corner-triangle which aims toward player ship
        if (this.ufoType === "L") {
            pos.x += (ship.center.x > pos.x ? 20 : -20);
            pos.y += (ship.center.y > pos.y ? 20 : -20);
        }

        //TODO: add inertia to shots?
        let shot = new Shot(pos, shotDir.normal, this.motionVec, this.ufoType);
        shots.push(shot);

        this.lastShotTimeMs = Date.now();
    } //Ufo.shoot


    destroy(isEndGameCleanup) {
        if (this.queuedMoves > 0) {
            this.queuedMoves = 0;
            svgRef.removeChild(this.element);

            if (isEndGameCleanup) return;

            this.explosion = svgDocument.createElementNS(svgns, "use");
            this.explosion.setAttributeNS(null, "href", "#explodeUFO-" + this.ufoType); //NOTE: BRITTLE SVG-ref
            this.explosion.setAttributeNS(null, "x", toStringRoundCent(this.position.x - this.radius * .5)); //explosion is 50% bigger than UFO; shift centerpoint
            this.explosion.setAttributeNS(null, "y", toStringRoundCent(this.position.y - this.radius * .5)); // ""
            svgRef.insertBefore(this.explosion, movingObjInsertPoint);
            makeSound("E");
            new Promise(r => explosionPromise(this.explosion, 400));
        }
    } //Ufo.destroy

} //class Ufo




/*
 * NOTE: Since game is currently only single-player, one player ship on screen
 * at a time, some methods could be made static since they only operate
 * on the one instance.
 * */
class PlayerShip extends movingObject {

    static rotationIncrement = .085; //TODO: GAMEPAD -- VARY per analog-stick motion?
    static thrust = .2;
    static retroThrust = .05; //quarter-power retro-rocket

    //Create new ship object with graphic SVG-polygon element at center of screen
    constructor() {
        super();

        this.center = new Vec2d(0,0,respawnPointX,respawnPointY);
        this.inertia = new Vec2d(0,0,0,0);
        this.rotation = Math.PI/2; //aim ship upward/vertical on screen
        this.destroyed = false;
        this.shieldTimeRemaining = maxShieldTime;
        this.warpsRemaining = maxWarpsAvail;
        shipSymbol.setAttributeNS(null, "display", "inline");
        polyShipFlame.setAttributeNS(null, "style", "display:none");
        rectShieldPct.setAttributeNS(null, "width", shieldRectMax.toString());
        this.render();
        this.updateWarpIndicator();
        this.raiseShield(); //prevent Player immediate-destruction

        //Give player a fighting chance if existing UFOs on screen
        delayUfosShooting(1000 - Math.min(currentLevel*10, 500));
    }

    shoot() {
        //starting point for shot
        const pos = new Vec2d();
        pos.x = this.center.x + (Math.cos(this.rotation + Math.PI)) * shipSize;
        pos.y = this.center.y + (Math.sin(this.rotation + Math.PI)) * shipSize;

        let shot = new Shot(pos, this.getDirection(), this.inertia, "P");
        shots.push(shot);
    } //PlayerShip.shoot()


    //Get direction as a normalized vector
    getDirection() {
        const x = this.center.x + (Math.cos(this.rotation + Math.PI)) * shipSize*2;
        const y = this.center.y + (Math.sin(this.rotation + Math.PI)) * shipSize*2;
        const vecDir = new Vec2d(this.center.x, this.center.y, x, y);
        return vecDir.normal;
    }


    //Update position, along one or more axes, by amount in global dX/dY variables.
    move() {
        if (deltaY > 0) { //thrust : increase inertia vector by current direction * thrust
            if (this.inertia.magnitude < maxPlayerVelocity) {
                this.inertia = this.inertia.add(Vec2d.sMult(this.getDirection(), PlayerShip.thrust));
            }
        }
        if (deltaY < 0) { // retro-rocket thrust;
            if (this.inertia.magnitude < maxPlayerVelocity / 2) {
                this.inertia = this.inertia.subtract(Vec2d.sMult(this.getDirection(), PlayerShip.retroThrust));
            }
        }
        if (deltaX > 0) { //clockwise
            this.rotation += PlayerShip.rotationIncrement;
        }
        if (deltaX < 0) { //counterclockwise
            this.rotation -= PlayerShip.rotationIncrement;
        }

        this.inertia = Vec2d.sMult(this.inertia, friction); //Calc inertia-reduction Friction... slows ship when coasting
        this.center = this.center.add(this.inertia); //...and, apply affect to our position.

        // Do screen wrapping at ship-center; no radius allowance
        this.center = this.screenWrap(this.center);
    } //PlayerShip.move


    warp() {
        if (this.warpsRemaining > 0) {
            this.warpsRemaining -= 1;
            this.updateWarpIndicator();

            const v2RandomPos = Vec2d.randomizeDirection(new Vec2d(0,0, 0,0));
            //prior vector can be +/1; thus, add (+/1) random-1/2-screen to mid-screen (respawn point)
            this.center.x = respawnPointX + v2RandomPos.x * respawnPointX;
            this.center.y = respawnPointY + v2RandomPos.y * respawnPointY;
        }
    }


    togglePlayerShield() {
        if (this.shieldTimeRemaining > 0) {
            if (shieldedModeActive === false) {
                this.raiseShield();
            }
            else {
                this.lowerShield();
            }
        }
    }

    raiseShield() {
        circShipShield.setAttributeNS(null, "cx", toStringRoundCent(this.center.x));
        circShipShield.setAttributeNS(null, "cy", toStringRoundCent(this.center.y));
        circShipShield.setAttributeNS(null, "display", "inline");
        shieldedModeActive = true;
    }

    lowerShield() {
        circShipShield.setAttributeNS(null, "display", "none");
        shieldedModeActive = false;
    }

    updateShieldIndicator(){
        rectShieldPct.setAttributeNS(null, "width", toStringRoundCent(shieldRectMax / maxShieldTime * this.shieldTimeRemaining));
    }

    updateWarpIndicator() {
        warpIndicator1.setAttributeNS(null, "display", (this.warpsRemaining > 0 ? "inline" : "none"));
        warpIndicator2.setAttributeNS(null, "display", (this.warpsRemaining > 1 ? "inline" : "none"));
        warpIndicator3.setAttributeNS(null, "display", (this.warpsRemaining > 2 ? "inline" : "none"));
    }

    //Radians to Degrees; also limit result to 2-decimals for friendlier SVG inspection
    rotationInDeg() {
        return (Math.round(this.rotation * 180 / Math.PI * 100) / 100);
    }

    render() {
        shipSymbol.setAttributeNS(null, "x", toStringRoundCent(this.center.x - shipSize));
        shipSymbol.setAttributeNS(null, "y", toStringRoundCent(this.center.y - shipSize));
        shipSymbol.setAttributeNS(null, "transform", `rotate(${this.rotationInDeg()} ${toStringRoundCent(this.center.x)} ${toStringRoundCent(this.center.y)})`);

        if (shieldedModeActive) {
            circShipShield.setAttributeNS(null, "cx", toStringRoundCent(this.center.x));
            circShipShield.setAttributeNS(null, "cy", toStringRoundCent(this.center.y));
            this.shieldTimeRemaining -= shieldUsePace;
            if (this.shieldTimeRemaining <= 0) {
                this.lowerShield();
            }
            this.updateShieldIndicator();
        }
    } //PlayerShip.render


    destroy() {
        if (!this.destroyed) {
            this.destroyed = true;

            this.explosion = svgDocument.createElementNS(svgns, "use");
            this.explosion.setAttributeNS(null, "href", "#explodeShip");
            this.explosion.setAttributeNS(null, "x", toStringRoundCent(this.center.x - shipSize*3));
            this.explosion.setAttributeNS(null, "y", toStringRoundCent(this.center.y - shipSize*3));
            svgRef.insertBefore(this.explosion, movingObjInsertPoint);
            makeSound("E");
            new Promise(r => explosionPromise(this.explosion, 600));

            shipSymbol.setAttributeNS(null, "display", "none"); //hide ship for now

            // Subtract a life from the lives remaining, update indicators
            if (--numLivesRemaining) {
                const livesRemainingElement = document.getElementById(`livesRemaining${numLivesRemaining}`);
                livesRemainingElement.setAttributeNS(null, "display", "none");
            }
        }
    } //PlayerShip.destroy

} //class PlayerShip



class Shot extends movingObject {

    /*
    pos = shot starting coordinates
    dirVec = direction (as Vec2d normal)
    shooterInertiaVec = shooter's velocity / inertial vector (if moving), to be incorporated in shot motion
    shooterType = P (Player) or S/L (Small/Large UFO) is the shooter
    */
    constructor(pos, dirVec, shooterInertiaVec, shooterType) {
        super();

        this.position = pos;
        this.isPlayerShooter = (shooterType === "P");
        let shotSpeed = ((shooterType === "P") ? playerShotSpeed : (shooterType === "L" ? ufoShotSpeed : ufoShotSpeed + 2));
        this.motionVec = Vec2d.sMult(dirVec, shotSpeed);
        //Include shooter's inertia, but not for UFOs
        if (shooterType === "P") {
            this.motionVec = this.motionVec.add(shooterInertiaVec);
        } else {
            //UFO has advanced accuracy: at lower-levels, photon-based-weaponry is aimed straight at player's current pos; higher levels aim at player's FUTURE position
            if (currentLevel > 4) {
                this.motionVec = this.motionVec.add(ship.inertia);
            }
        }
        this.queuedMoves = Math.round(respawnPointX / shotSpeed); //# of moves to span 1/2 width of screen;

        this.element = svgDocument.createElementNS(svgns, "circle");
        this.element.setAttributeNS(null, "class", (this.isPlayerShooter ? "ship-shot" : "ufo-shot"));
        svgRef.appendChild(this.element);

        makeSound(shooterType);
        this.motionProcessing(); //Ensure FIRST render displays shot at vehicle-gun-exit loc
    } //Shot constructor


    motionProcessing() {
        this.element.setAttributeNS(null, "cx", toStringRoundCent(this.position.x));
        this.element.setAttributeNS(null, "cy", toStringRoundCent(this.position.y));

        this.position = this.position.add(this.motionVec);

        this.position = this.screenWrap(this.position);
        this.queuedMoves--;

        //Test for UFO shots hitting player ship while their shield is down.
        if ((!this.isPlayerShooter) &&
            (!ship.destroyed) &&
            (shieldedModeActive === false) &&
            this.hitTestPlayerShip(this.position.x + shotRadius, this.position.y + shotRadius, shotRadius)) {
            this.queuedMoves = 0; //Player ship was hit; this shot is done moving.
            ship.destroy();
        }

        //Test for player shot hitting any UFO (by comparing shot pos to all UFO-positions)
        if (this.isPlayerShooter) {
            for (let i = 0; i < ufos.length; i++) {
                if (this.hitTestUfo(ufos[i].position.x + ufos[i].radius, ufos[i].position.y + ufos[i].radius, shotRadius + ufos[i].radius)) {
                    UpdateScore(ufos[i].ufoType === "L" ? 200 : 1000);
                    this.queuedMoves = 0;
                    ufos[i].destroy();
                    break;
                }
            }
        }

    } //Shot.motionProcessing

    //UFO can be hit by player Shot or player Ship.
    //In this Shot class, only test player-shot hitting UFO (ship collisions handled in UFO class)
    //  x, y, r = x/y-position and radius of ship or shot potentially hitting UFO; adjust shot-pos center first.
    hitTestUfo(x, y, r) {
        return (getDistanceBetweenTwoPoints(this.position.x + shotRadius, this.position.y + shotRadius, x, y) < (shotRadius + r));
    }

    //Player Ship can be hit by UFO shot.
    //  x, y, r = x/y-position and radius of ship or shot potentially hitting UFO
    hitTestPlayerShip(x, y, r) {
        return (getDistanceBetweenTwoPoints(ship.center.x, ship.center.y, x, y) < (shipSize + r));
    }

    destroy() {
        svgRef.removeChild(this.element);
    }
} //class Shot


//███████████████████████████████████████████████████████████
//■■■■           Global Functions                        ■■■■
//███████████████████████████████████████████████████████████
const explosionPromise = (elExplosion, msWait) =>
    new Promise(async function (resolve) {
        await new Promise(r => setTimeout(r, msWait)).then((data) => {
            svgRef.removeChild(elExplosion);
        });
    });

const createUfoPromise = (ufoType, msWait) =>
    new Promise(async function (resolve) {
        const initiatingGameNumber = gameNumber;
        //Schedule, per main loop, as often as 5secs, another UFO if no other UFO on screen
        nextUfoSpawnTime = Date.now() + msWait + Math.max(15000 - currentLevel * 250, 5000);

        await new Promise(r => setTimeout(r, msWait)).then(async (data) => {
            //do not queue more than few "leftovers" from prior levels
            if (ufos.length > 7) return;

            //max 4 UFOs on screen at a time
            while (ufos.length >= 4) {
                await new Promise(r => setTimeout(r, 500)); //retry every half second
            }
            //game may have ended; test before adding queued.
            if (gameNumber === initiatingGameNumber) {
                ufos.push(new Ufo(ufoType));
            }
        });
    });


function getDistanceBetweenTwoPoints(x1, y1, x2, y2) {
    const xDiff = (x2 - x1);
    const yDiff = (y2 - y1);
    return Math.sqrt(xDiff * xDiff + yDiff * yDiff);
}

//This makes inspecting the SVG elements properties much easier:
//(since many computed numbers extend MANY decimal places otherwise)
function toStringRoundCent(value) {
    return (Math.round(value * 100) / 100).toString(); //keep 2 decimals precision
}


//This is ultra-simplified sound-generation in just code (vs. using external MP3/OGG/etc for each sound)
function makeSoundPart(waveForm, durationSecs, freqHz, startDelay){
    let oscillator      = audioCtx.createOscillator(); //https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/createOscillator
    let gainNode        = audioCtx.createGain();

    oscillator.connect(gainNode);

    oscillator.type = waveForm;
    oscillator.frequency.value = freqHz;
    gainNode.gain.linearRampToValueAtTime(1, startDelay + audioCtx.currentTime + (durationSecs/2));
    gainNode.gain.linearRampToValueAtTime(0, startDelay + audioCtx.currentTime + durationSecs);

    gainNode.connect(audioCtx.destination);
    oscillator.start(0);
    oscillator.stop(startDelay + audioCtx.currentTime + durationSecs);
}

//soundType values:
// E: Explosion (of UFO or Ship )
// P: Player weapon fired
// L/S: Large/Small UFO weapon fired
function makeSound(soundType) {
    switch (soundType) {
        case "P":
            makeSoundPart('sawtooth', .1, 720, 0);
            makeSoundPart('square', .2, 120, 0);
            break;
        case "L":
            makeSoundPart('sine', .1, 220, 0);
            makeSoundPart('sine', .1, 330, 0);
            makeSoundPart('sine', .1, 220, 0);
            break;
        case "S":
            makeSoundPart('sine', .1, 880, 0);
            makeSoundPart('sine', .1, 990, 0);
            makeSoundPart('sine', .1, 880, 0);
            break;
        case "E":
            for (let i = 0; i < 8; i++) {
                makeSoundPart('sawtooth', .1, Math.round(Math.random()*100), i * .1);
            }
            break;
    } //switch
}


function KeyDown(key) {
    if ((ship === undefined) || (ship.destroyed)) return;
    switch (key.keyCode) {
        case KEY_W: ship.warp(); break;
        case KEY_S: ship.togglePlayerShield(); break;
        default: ToggleKey(key.keyCode, true);
    }
    key.preventDefault();
}


function KeyUp(key) {
    ToggleKey(key.keyCode, false);
}


function ToggleKey(keyCode, isKeyDown) {
    switch (keyCode) {
        case KEY_SPACE:
            keyShootPressed = isKeyDown;
            if (isKeyDown === false) {
                readyToShoot = true;
            }
            break;
        case KEY_LEFT: keyLeftPressed = isKeyDown; break;
        case KEY_UP:
            keyUpPressed = isKeyDown;
            polyShipFlame.setAttributeNS(null, "style", "display:" + (keyUpPressed ? "inline" : "none"));
            break;
        case KEY_RIGHT: keyRightPressed    = isKeyDown; break;
        case KEY_DOWN: keyDownPressed     = isKeyDown; break;
    }
 }


function getNewRockData(radius) {
    const angleStep = 18; //make 20 potential points/bumps around circumference
    let x, y = 0;

    const rock = new RockData();
    rock.radius = radius;
    rock.centroidOffset = new Vec2d(0,0, radius - (Math.random() * radius/3), radius - (Math.random() * radius/3));

    //The circle-draw loop starts at positive x-axis, y=0
    let polyString = "";
    for(let angleInDegrees = 0;  angleInDegrees < 360;  angleInDegrees += angleStep) {
        // Convert from degrees to radians via multiplication by PI/180
        x = (radius * Math.cos(angleInDegrees * Math.PI / 180)) + radius;
        y = (radius * Math.sin(angleInDegrees * Math.PI / 180)) + radius;
        x += ((x < radius ? 1 : -1) * Math.random() * (Math.abs(radius - x) + 1)/2.5); //a lower final divisor makes craggier rocks
        y += ((y < radius ? 1 : -1) * Math.random() * (Math.abs(radius - y) + 1)/2.5); // ""  "";  2.5 was nice balance.
        polyString += Math.round(x).toString() + "," + Math.round(y).toString() + " ";
    }

    rock.path = polyString;
    return rock;
}


function delayUfosShooting(msDelay) {
    for (let i = 0; i < ufos.length; i++) {
        ufos[i].lastShotTimeMs = Date.now() + msDelay;
    }
}


function UpdateScore(increment) {
    score += increment;
    textScore.firstChild.nodeValue = `Score: ${score}`;

    //Check for bonus-ship award (but, max 4 total ships); update indicators
    //If bonus-level passed up (due to max ships), allow it to be awarded later vs. missing chance.
    if ((bonusShipAwards.length !== 0) && (numLivesRemaining < maxPlayerLives) && (score >= bonusShipAwards[0])) {
        const livesRemainingElement = document.getElementById(`livesRemaining${numLivesRemaining}`); //Note: visual indicators are (livesremaining -1)
        livesRemainingElement.setAttributeNS(null, "display", "inline");
        numLivesRemaining++;
        bonusShipAwards.shift(); //Remove the bonus we just used.
    }
}


function initGameState() {
    //Set any ONE-TIME-ONLY event handlers,  object references, etc here
    if (isFirstRun) {
        isFirstRun = false;
        audioCtx = new AudioContext();

        window.addEventListener("gamepadconnected", function(e) {
            gamePad = navigator.getGamepads()[e.gamepad.index];
            priorGamePad = gamePad;
            // console.log("Gamepad connected at index %d: %s. %d buttons, %d axes.",
            //     gamePad.index, gamePad.id,
            //     gamePad.buttons.length, gamePad.axes.length);
        });
    }

    //Reset to original state
    ship = undefined;
    numLivesRemaining = 4; //total lives at game-start (max=5 if none lost and 10K bonus-level reached)
    score = 0;
    UpdateScore(0);
    bonusShipAwards = [ 10000, 50000, 100000, 250000, 500000, 1000000 ];
    currentLevel = 0;
    gameNumber++;
    shieldedModeActive = false;
    levelInitializeState = false;
    shipRespawning = false;
    keyUpPressed    = false;
    keyDownPressed  = false;
    keyLeftPressed  = false;
    keyRightPressed = false;
    keyShootPressed = false;
    readyToShoot = true;

    deltaX = 0;
    deltaY = 0;

    liFeIndicator1.setAttributeNS(null, "display", "inline");
    liFeIndicator2.setAttributeNS(null, "display", "inline");
    liFeIndicator3.setAttributeNS(null, "display", "inline");
    liFeIndicator4.setAttributeNS(null, "display", "none");

    //Clear any leftover debris from prior game before re-start
    for (let i = 0; i < rocks.length; i++) {
        rocks[i].destroy(true);
    }
    rocks = [];

    for (let i = 0; i < shots.length; i++) {
        shots[i].destroy();
    }
    shots = [];

    for (let i = 0; i < ufos.length; i++) {
        ufos[i].destroy(true);
    }
    ufos = [];

    //If possible, grab high-score from localstorage
    if (scoreStorage != undefined) {
    	if (!scoreStorage.highScore) { scoreStorage.highScore = 0; }
        textHighScore.firstChild.nodeValue = `High Score: ${scoreStorage.highScore}`;
    }

} //initGameState


const KeyDownStart = () => new Promise(resolve => window.addEventListener('keypress', resolve, {once: true}));

//■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
//Loop which takes place at start of new games, whether game
//is the first-run or a subsequent run via "N" (new game) key.
//WAIT here for NEW-GAME-KEY to be pressed before launching
//the primary animation-loop (MainLoop).
//■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
async function StartGame() {
    while (true) {
        if ((await KeyDownStart()).code !== KEY_N) continue;
        initGameState();

        // Global keyboard event handlers
        document.addEventListener("keydown", KeyDown, true);
        document.addEventListener("keyup", KeyUp, true);

        textGameOver.setAttributeNS(null, "display", "none");
        textGameIntro.setAttributeNS(null, "display", "none");

        MainLoop();
    }
 }


//Processing to setup each new game level (including initial level)
async function PrepNewGameLevel() {
    currentLevel++;
    levelInitializeState = true;

    shieldUsePace = 9 + Math.min(currentLevel, 10); //Burn shield faster at higher levels

    //Create initial large rocks; 3 at level 1, then more, up to 8 max
    const initialRockCount = Math.min(2 + currentLevel, 8);
    for (let i = 0; i < initialRockCount; i++) {
        rocks.push(new Rock(getNewRockData(rockRadiusL)));
    }

    //Always have one large UFO per level
    new Promise(r => createUfoPromise("L", 5000 + Math.random() * 5000)); //Sometime in first 5-10secs of level
    //Add a small UFO to the mix at level 3+
    if (currentLevel > 2) {
        new Promise(r => createUfoPromise("S", 10000 + Math.random() * 5000)); //10-15secs
    }
    //and so on... more complexity with rising levels
    if (currentLevel > 4) {
        new Promise(r => createUfoPromise("L", 15000 + Math.random() * 10000)); //15-25secs
    }
    if (currentLevel > 6) {
        new Promise(r => createUfoPromise("S", 20000 + Math.random() * 10000)); //20-30secs
    }
    if (currentLevel > 8) {
        new Promise(r => createUfoPromise("L", 1000 + Math.random() * 4000)); //1-5secs
    }
    if (currentLevel > 10) {
        new Promise(r => createUfoPromise("S", 30000 + Math.random() * 10000)); //30-40secs
    }

    //game-start requirement: create initial ship
    if (ship === undefined) {
        //prevent multiple simultaneous respawn attempts
        if (!shipRespawning) {
            spawnNewShip();
        }
    } else {
        //Player earns a bit of shield-power each new level (about a second worth)
        ship.shieldTimeRemaining = (Math.min(ship.shieldTimeRemaining + shieldBonusTimePerLevel, maxShieldTime));
        ship.updateShieldIndicator();
        ship.warpsRemaining = (Math.min(ship.warpsRemaining + 1, maxWarpsAvail));
        ship.updateWarpIndicator();
    }

    // Display new level text briefly before continuing...
    textLevel.textContent = `Level: ${currentLevel}`;
    textLevel.setAttributeNS(null, "display", "inline");
    await new Promise(r => setTimeout(r, introTime));
    textLevel.setAttributeNS(null, "display", "none");

    levelInitializeState = false;
} //PrepNewGameLevel



function CheckRespawnPointIsClear() {
    let pointIsClear = true;
    if (ship === undefined) return;

    for (let i = 0; i < rocks.length; i++) {
        if (rocks[i].hitTest(respawnPointX, respawnPointY, shipSize*4)) { //multiples of ship-diameter for maneuver room
            pointIsClear = false;
            break; //one hit says it all
        }
    }
    //No rocks,... how about UFOs?
    if (pointIsClear) {
        for (let i = 0; i < ufos.length; i++) {
            if (getDistanceBetweenTwoPoints(respawnPointX, respawnPointY, ufos[i].position.x + ufos[i].radius, ufos[i].position.y + ufos[i].radius) < (ufos[i].radius + shipSize*10)) {
                pointIsClear = false;
                break; //UFO in the way
            }
        }
    }

    return pointIsClear;
}


const respawnPromise = () =>
    new Promise(async function (resolve) {
        await new Promise( async r => {
            while (CheckRespawnPointIsClear() === false) {
                await new Promise(r => setTimeout(r, 100));  //retry every 10th of second until a clear respawn area is found
            }
            ship = new PlayerShip();
            shipRespawning = false;
        })
    });


async function spawnNewShip() {
    shipRespawning = true;
    await new Promise(r => setTimeout(r, 1000)).then((data) => {
        new Promise(r => respawnPromise());
    });
}


//■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
//■■■■     This is the core game Animation-Loop          ■■■■
//■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
async function MainLoop() {
    if (rocks.length === 0) {
        if (levelInitializeState === false) {
            PrepNewGameLevel();
        }
    }

    //if Player has enjoyed prolonged period without any UFOs to battle... within .5 - 1.5 secs, that changes; levels 10+ can bring 2 onto field
    if ((ufos.length <= (currentLevel < 10 ? 0 : 1)) && (levelInitializeState === false) && (nextUfoSpawnTime < Date.now())) {
        new Promise(r => createUfoPromise((Math.random() > .5 ? "L" : "S"), Math.round(Math.random()*500 + 1000)));
    }

    //Compute user input:
    // - if controller being used, emulate keyboard events based on input
    if ((gamePad) && (ship !== undefined) && !(ship.destroyed)) {
        gamePad = navigator.getGamepads()[0];
        if (gamepadTimestamp !== gamePad.timestamp) {
            gamepadTimestamp = gamePad.timestamp;

            //right-trigger -- act like space-bar pressed
            if (gamePad.buttons[gamepadTriggerR].pressed !== priorGamePad.buttons[gamepadTriggerR].pressed) {
                keyShootPressed = gamePad.buttons[gamepadTriggerR].pressed;
                if (keyShootPressed === false) {
                    readyToShoot = true;
                }
            }

            //Shield and Warp... only act on the equiv of "button down" (not release)
            if (gamePad.buttons[gamepadTriggerL].pressed !== priorGamePad.buttons[gamepadTriggerL].pressed) {
                if (gamePad.buttons[gamepadTriggerL].pressed) {
                    ship.togglePlayerShield();
                }
            }

            if (gamePad.buttons[gamepadLeftTopShoulder].pressed !== priorGamePad.buttons[gamepadLeftTopShoulder].pressed) {
                if (gamePad.buttons[gamepadLeftTopShoulder].pressed) {
                    ship.warp();
                }
            }

            //Steering....
            if (Math.abs(gamePad.axes[gamepadAxisX]) > gamepadStickMin) {
                if (gamePad.axes[gamepadAxisX] > 0) {
                    ToggleKey(KEY_RIGHT, true);
                } else {
                    ToggleKey(KEY_LEFT, true);
                }
            } else {
                ToggleKey(KEY_LEFT, false);
                ToggleKey(KEY_RIGHT, false);
            }

            if (Math.abs(gamePad.axes[gamepadAxisY]) > gamepadStickMin) {
                if (gamePad.axes[gamepadAxisY] > 0) {
                    ToggleKey(KEY_DOWN, true);
                } else {
                    ToggleKey(KEY_UP, true);
                }
            } else {
                ToggleKey(KEY_UP, false);
                ToggleKey(KEY_DOWN, false);
            }

            priorGamePad = gamePad;
        }
    }

    //At this point, the keyboard event-handlers will have acquired potential
    //events, whether originating from gamepad or actual keyboard.
    //Use these to determine PlayerShip shooting/motion now...
    //Compute user input: now keyboard
    if (keyShootPressed && readyToShoot) {
        if (!ship.destroyed) {
            ship.shoot();
        }
        readyToShoot = false;
    }

    deltaX = 0;
    deltaY = 0;

    //TODO: GAMEPAD -- VARY per analog-stick motion? Make deltas variable; use in move() calcs.
    if (keyUpPressed || keyDownPressed) {
        deltaY = (keyUpPressed ? 1 : -1);
    }

    if (keyLeftPressed || keyRightPressed) {
        deltaX = (keyRightPressed ? 1 : -1);
    }

    //Apply any ship movement; respawn ship if needed.
    if (ship !== undefined) {
        if (ship.destroyed) {
            //before awaiting ship-respawn, make sure existing shot-animations done.
            if (shots.length === 0) {
                //prevent multiple simultaneous respawn attempts
                if (!shipRespawning) {
                    spawnNewShip();
                }
            }
        } else {
            ship.move();
            ship.render();
        }
    }

    movingObject.processQueuedMotion(rocks);
    movingObject.processQueuedMotion(ufos);
    movingObject.processQueuedMotion(shots);

    //Is game over?
    if (numLivesRemaining === 0) {
        textGameIntro.setAttributeNS(null, "display", "inline");
        textGameOver.setAttributeNS(null, "display", "inline");

        document.removeEventListener("keydown", KeyDown, true);
        document.removeEventListener("keyup", KeyUp, true);

        // Update highscore
        if (scoreStorage !== undefined) {
            const currentHighScore = parseInt(scoreStorage.highScore, 10);
            if (score > currentHighScore) {
                scoreStorage.highScore = score; //new high score
            }
        }

        //This flags browser that anim-loop is over (so we go back to start and allow new game)
        cancelAnimationFrame(rAF);
        return; //really go back to caller immediately
    }

    rAF = requestAnimationFrame(MainLoop);
} //MainLoop