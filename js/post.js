// Финальный стилизующий проход: контуры (глубина + нормали), мягкое сжатие светов,
// цветокор, виньетка, зерно. В режиме R.E.P.O. — крупные пиксели, дизеринг, палитра.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export class StylePass extends Pass {
  constructor(scene, camera, style) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.style = style;
    this.hide = []; // объекты, которые не должны давать контур (дым)
    this.normalMat = new THREE.MeshNormalMaterial();
    this.nrt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.nrt.depthTexture = new THREE.DepthTexture(1, 1);
    this.nrt.depthTexture.type = THREE.UnsignedIntType;
    const mode = { toon: 1, repo: 2, clean: 0 }[style] ?? 1;
    this.uniforms = {
      tDiffuse: { value: null }, tNormal: { value: this.nrt.texture }, tDepth: { value: this.nrt.depthTexture },
      res: { value: new THREE.Vector2(1, 1) }, near: { value: camera.near }, far: { value: camera.far },
      time: { value: 0 }, poison: { value: 0 }, flash: { value: 0 }, fade: { value: 0 },
      mode: { value: mode }, pixel: { value: 3.0 }, ink: { value: mode === 2 ? 0.55 : mode === 1 ? 1.0 : 0.0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse, tNormal, tDepth;
        uniform vec2 res; uniform float near, far, time, poison, flash, fade, pixel, ink; uniform int mode;
        varying vec2 vUv;
        float lin(float d){ float z = d * 2.0 - 1.0; return 2.0 * near * far / (far + near - z * (far - near)); }
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float bayer(vec2 p){
          vec2 q = mod(floor(p), 4.0);
          int i = int(q.x + q.y * 4.0);
          float m[16];
          m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
          for (int k = 0; k < 16; k++) if (k == i) return m[k] / 16.0 - 0.5;
          return 0.0;
        }
        vec3 N(vec2 uv){ return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }
        float D(vec2 uv){ return lin(texture2D(tDepth, uv).x); }
        // мягкое колено: всё, что выше 0.8, плавно прижимается — белых пятен нет
        vec3 knee(vec3 c){ vec3 k = vec3(0.78); vec3 o = c - k; return mix(c, k + o / (1.0 + o * 2.2), step(k, c)); }
        void main(){
          vec2 uv = vUv;
          vec2 px = 1.0 / res;
          if (mode == 2) { vec2 cell = pixel * px; uv = (floor(uv / cell) + 0.5) * cell; }
          uv += poison * 0.007 * vec2(sin(uv.y * 16.0 + time * 2.7), cos(uv.x * 13.0 + time * 2.1));
          vec2 d = uv - 0.5;
          float ca = 0.0008 + poison * 0.008 + flash * 0.004;
          vec3 col = vec3(texture2D(tDiffuse, uv + d * ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d * ca).b);

          // контуры
          float edge = 0.0;
          if (ink > 0.0) {
            float s = mode == 2 ? pixel : max(1.0, res.y / 900.0);
            vec2 o = px * s;
            float dc = D(uv); vec3 nc = N(uv);
            float d1 = D(uv + vec2(o.x, 0.0)), d2 = D(uv - vec2(o.x, 0.0)), d3 = D(uv + vec2(0.0, o.y)), d4 = D(uv - vec2(0.0, o.y));
            float dd = abs(d1 + d2 + d3 + d4 - 4.0 * dc) / max(dc, 0.1);
            float de = smoothstep(0.06, 0.14, dd);
            vec3 n1 = N(uv + vec2(o.x, 0.0)), n2 = N(uv - vec2(o.x, 0.0)), n3 = N(uv + vec2(0.0, o.y)), n4 = N(uv - vec2(0.0, o.y));
            float nd = (1.0 - dot(nc, n1)) + (1.0 - dot(nc, n2)) + (1.0 - dot(nc, n3)) + (1.0 - dot(nc, n4));
            float ne = smoothstep(0.35, 0.8, nd);
            edge = max(de, ne) * ink * (1.0 - smoothstep(9.0, 26.0, dc));
          }

          col = knee(col);
          float l = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(vec3(l), col, mode == 1 ? 1.18 : 1.08);
          col *= mix(vec3(0.9, 0.96, 1.08), vec3(1.05, 1.0, 0.9), smoothstep(0.05, 0.6, l));
          col = mix(col, col * (1.0 - 0.82) + vec3(0.07, 0.045, 0.035) * 0.0, edge);
          col = mix(col, col * vec3(0.72, 1.12, 0.5) + vec3(0.03, 0.06, 0.0), poison * 0.75);

          if (mode == 2) {
            // R.E.P.O.: ограниченная палитра с дизерингом
            float lv = 7.0;
            col = floor(col * lv + 0.5 + bayer(gl_FragCoord.xy / pixel) * 0.9) / lv;
          }

          float v = smoothstep(0.98, 0.3, length(d * vec2(1.1, 1.0)));
          col *= mix(1.0, v, 0.8);
          col += flash * vec3(0.9, 0.25, 0.15) * 0.28;
          col += (h(floor(gl_FragCoord.xy / (mode == 2 ? pixel : 1.0)) + fract(time) * 17.0) - 0.5) * (mode == 2 ? 0.06 : 0.035);
          col *= 1.0 - fade;
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }`,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }

  setSize(w, h) {
    this.nrt.setSize(w, h);
    this.uniforms.res.value.set(w, h);
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.uniforms;
    if (u.ink.value > 0) {
      const bg = this.scene.background, fog = this.scene.fog, ov = this.scene.overrideMaterial;
      const hidden = this.hide.filter((o) => o.visible);
      hidden.forEach((o) => { o.visible = false; });
      this.scene.background = null; this.scene.fog = null; this.scene.overrideMaterial = this.normalMat;
      const au = renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate = false;
      renderer.getClearColor(this._cc = this._cc || new THREE.Color());
      const ca = renderer.getClearAlpha();
      renderer.setRenderTarget(this.nrt);
      renderer.setClearColor(0x8080ff, 1);
      renderer.clear();
      renderer.render(this.scene, this.camera);
      renderer.setClearColor(this._cc, ca);
      renderer.shadowMap.autoUpdate = au;
      this.scene.background = bg; this.scene.fog = fog; this.scene.overrideMaterial = ov;
      hidden.forEach((o) => { o.visible = true; });
    }
    u.tDiffuse.value = readBuffer.texture;
    u.near.value = this.camera.near; u.far.value = this.camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }
}
