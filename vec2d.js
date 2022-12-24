/* 2D Vectors:
A vector is simply an X & Y value representing a magnitude and direction
(using Carteisan coordinates). The Zero-vector resides at the 0,0 origin.

Properties:
    x: the X-axis offset (+/-) from origin
    y: the X-axis ...
*/
class Vec2d {
    static toString(vec) {
        return "[" + vec.x + "," + vec.y + "]"
    }

    //scalar multiply
    static sMult(vec, scalar) {
        vec.x = vec.x * scalar;
        vec.y = vec.y * scalar;
        return vec;
    }

    static randomizeDirection(vec) {
        vec.x = Math.random();
        vec.y = Math.random();
        const temp = vec.normal;
        //now make x and y randomly pos/neg values
        vec.x = temp.x * ((Math.random() > .5) ? -1 : 1);
        vec.y = temp.y * ((Math.random() > .5) ? -1 : 1);
        return vec;
    }

    //Create vector from two points
    constructor (x1, y1, x2, y2) {
        this.x = x2 - x1;
        this.y = y2 - y1;
    }

    get magnitude() {
        return Math.sqrt(this.x*this.x + this.y*this.y);
    }

    get normal() {
        const mag = (this.magnitude > 1 ? this.magnitude : 1); //randomizeDirection requires len=1
        const ret = new Vec2d(0,0,0,0);
        ret.x = this.x / mag;
        ret.y = this.y / mag;
        return ret;
    }

    add(vec2) {
        const ret = new Vec2d(0,0,0,0);
        ret.x = this.x + vec2.x;
        ret.y = this.y + vec2.y;
        return ret;
    }

    subtract(vec2) {
        const ret = new Vec2d(0,0,0,0);
        ret.x = this.x - vec2.x;
        ret.y = this.y - vec2.y;
        return ret;
    }

    rotateByRadians(cx, cy, radians) {
        const oldX = this.x;
        const oldY = this.y;

        this.x = cx + (Math.cos(radians) * (oldX - cx) - Math.sin(radians) * (cy - oldY));
        this.y = cy + (Math.sin(radians) * (oldX - cx) + Math.cos(radians) * (cy - oldY));
    }
}