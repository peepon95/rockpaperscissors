import * as T from 'three';
import { FIGHTERS, type Fighter, type Move, type RoundResult } from './game';

type Rig = { group: T.Group; body: T.Group; arms: T.Group[]; legs: T.Group[] };
const mat = (color: string | number, metalness = .15) => new T.MeshStandardMaterial({ color, roughness: .58, metalness, flatShading: true });
function mesh(parent: T.Object3D, geometry: T.BufferGeometry, material: T.Material, x = 0, y = 0, z = 0) {
  const m = new T.Mesh(geometry, material); m.position.set(x, y, z); parent.add(m); return m;
}
function box(parent: T.Object3D, material: T.Material, size: number[], pos: number[]) { return mesh(parent, new T.BoxGeometry(...size as [number, number, number]), material, ...pos as [number, number, number]); }
function makeFighter(f: Fighter): Rig {
  const group = new T.Group(), body = new T.Group(); group.add(body);
  const suit = mat(f.color), skin = mat(f.skin), dark = mat('#181b28'), white = mat('#f3f0e2'), metal = mat('#68798b', .8);
  const robot = f.id === 'bolt', ninja = f.id === 'phantom', wrestler = f.id === 'titan', zen = f.id === 'zen';
  const torso = mesh(body, new T.CylinderGeometry(.52, .36, .9, 6), robot || ninja || zen ? suit : skin, 0, 1.75);
  torso.scale.z = .65;
  box(body, dark, [.74, .33, .46], [0, 1.15, 0]);
  box(body, suit, [.78, .14, .49], [0, 1.31, 0]);
  if (zen) { const belt = box(body, dark, [.1, .45, .06], [.15, 1.14, .28]); belt.rotation.z = .2; }
  if (robot) { box(body, dark, [.54, .5, .06], [0, 1.8, .36]); box(body, new T.MeshBasicMaterial({ color: f.color }), [.3, .09, .08], [0, 1.85, .4]); }
  if (f.id === 'riot') { box(body, dark, [.2, .78, .47], [-.35, 1.74, .03]); box(body, dark, [.2, .78, .47], [.35, 1.74, .03]); }
  mesh(body, new T.CylinderGeometry(.16, .2, .2, 8), skin, 0, 2.28);
  const head = mesh(body, new T.BoxGeometry(.53, .61, .48), robot ? metal : ninja || wrestler ? suit : skin, 0, 2.62);
  head.rotation.z = -.04;
  if (ninja) { box(body, dark, [.55, .19, .51], [0, 2.48, 0]); box(body, skin, [.4, .13, .03], [0, 2.67, .25]); }
  if (wrestler) { box(body, dark, [.42, .15, .035], [0, 2.69, .25]); box(body, white, [.1, .53, .035], [0, 2.65, .265]); }
  if (!ninja && !robot && !wrestler) {
    box(body, dark, [.56, .15, .51], [0, 2.95, -.02]);
    if (f.id === 'riot') box(body, suit, [.16, .24, .5], [0, 3.09, -.02]);
    if (zen) mesh(body, new T.SphereGeometry(.17, 8, 6), dark, 0, 2.98, -.22);
  }
  for (const x of [-.13, .13]) {
    box(body, robot ? new T.MeshBasicMaterial({ color: '#c3fbff' }) : dark, [.1, .055, .03], [x, 2.68, .265]);
    if (!robot) { const brow = box(body, dark, [.13, .045, .04], [x, 2.76, .27]); brow.rotation.z = x < 0 ? -.18 : .18; }
  }
  if (!ninja) box(body, dark, [.14, .035, .03], [0, 2.46, .258]);
  if (f.id === 'brick') { box(body, suit, [.56, .09, .52], [0, 2.86, 0]); box(body, white, [.2, .035, .04], [0, 2.87, .27]); }
  const arms: T.Group[] = [], legs: T.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = new T.Group(); arm.position.set(side * .53, 2.05, 0); body.add(arm); arms.push(arm);
    mesh(arm, new T.SphereGeometry(.27, 8, 6), robot || ninja || zen ? suit : skin);
    const upper = mesh(arm, new T.CylinderGeometry(.19, .17, .53, 8), robot ? metal : ninja || zen ? suit : skin, side * .1, -.27, .09); upper.rotation.z = side * .25;
    mesh(arm, new T.SphereGeometry(.21, 8, 6), dark, side * .15, -.5, .15);
    const fore = mesh(arm, new T.CylinderGeometry(.2, .16, .42, 8), skin, side * .12, -.51, .32); fore.rotation.x = -1.1;
    const glove = mesh(arm, new T.IcosahedronGeometry(f.id === 'brick' ? .34 : .27, 1), suit, side * .1, -.43, .53); glove.scale.set(1, .95, 1.1);
    box(arm, white, [.31, .08, .29], [side * .11, -.56, .39]);
    const leg = new T.Group(); leg.position.set(side * .23, 1.03, 0); group.add(leg); legs.push(leg);
    mesh(leg, new T.CylinderGeometry(.2, .16, .47, 6), ninja || zen ? suit : dark, 0, -.19, 0);
    mesh(leg, new T.SphereGeometry(.16, 8, 6), suit, 0, -.43, .04);
    mesh(leg, new T.CylinderGeometry(.145, .13, .38, 6), robot ? metal : skin, 0, -.62, 0);
    box(leg, dark, [.32, .26, .49], [0, -.87, .1]); box(leg, suit, [.33, .07, .5], [0, -.98, .1]);
  }
  if (wrestler) group.scale.set(1.16, 1.06, 1.16);
  return { group, body, arms, legs };
}
function dispose(object: T.Object3D) {
  const materials = new Set<T.Material>();
  object.traverse(o => { if (o instanceof T.Mesh || o instanceof T.Points) { o.geometry.dispose(); const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach((v: T.Material) => materials.add(v)); } });
  materials.forEach(m => m.dispose());
}
export class Arena {
  renderer: T.WebGLRenderer;
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(40, 1, .1, 100);
  mode: 'home' | 'select' | 'fight' | 'winner' = 'home';
  reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private rigs: Rig[] = [];
  private effects = new T.Group();
  private attack: { result: RoundResult; start: number } | null = null;
  private entrance = 0;
  private winner = 0;
  private clock = new T.Clock();
  private time = 0;
  private particles: T.Points;
  private target = new T.Vector3();
  private camTarget = new T.Vector3();
  private observer: ResizeObserver;
  private beams: T.Mesh[] = [];
  portraits: Record<string, string> = {};
  constructor(private host: HTMLElement) {
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = T.SRGBColorSpace; this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.25;
    this.renderer.domElement.setAttribute('aria-label', 'Live 3D fighting arena'); this.renderer.domElement.setAttribute('role', 'img'); host.append(this.renderer.domElement);
    this.scene.background = new T.Color('#0b0b13'); this.scene.fog = new T.FogExp2('#0b0b13', .035);
    this.scene.add(new T.HemisphereLight('#dcd4ff', '#34303f', 2));
    const key = new T.DirectionalLight('#fff3d9', 4); key.position.set(-3, 8, 6); this.scene.add(key);
    const rim = new T.DirectionalLight('#9976ff', 5); rim.position.set(4, 5, -4); this.scene.add(rim);
    const fill = new T.PointLight('#d8fc52', 12, 14); fill.position.set(-5, 3, 1); this.scene.add(fill);
    this.buildStadium();
    this.scene.add(this.effects);
    const positions = new Float32Array(180 * 3);
    for (let i = 0; i < positions.length; i += 3) { positions[i] = (Math.random() - .5) * 28; positions[i + 1] = Math.random() * 9; positions[i + 2] = (Math.random() - .5) * 20; }
    const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
    this.particles = new T.Points(geometry, new T.PointsMaterial({ color: '#c8baff', size: .035, transparent: true, opacity: .5 })); this.scene.add(this.particles);
    this.createPortraits(); this.setFighters(FIGHTERS[0], FIGHTERS[1]);
    this.camera.position.set(10, 7, 15); this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host); this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
    this.renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); document.dispatchEvent(new CustomEvent('arena-lost')); });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => location.reload());
  }
  private buildStadium() {
    const platform = mesh(this.scene, new T.CylinderGeometry(5.7, 6, .35, 8), mat('#22232d'), 0, -.22); platform.rotation.y = Math.PI / 8;
    const floor = mesh(this.scene, new T.CylinderGeometry(5.55, 5.55, .04, 8), mat('#45454b'), 0, -.025); floor.rotation.y = Math.PI / 8;
    const ring = mesh(this.scene, new T.RingGeometry(3.45, 3.49, 64), new T.MeshBasicMaterial({ color: '#77766d', side: T.DoubleSide }), 0, .008); ring.rotation.x = -Math.PI / 2;
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 1024; const ctx = canvas.getContext('2d')!;
    ctx.textAlign = 'center'; ctx.fillStyle = '#72716b'; ctx.font = 'italic 900 135px sans-serif'; ctx.fillText('THROW', 512, 470); ctx.fillText('DOWN', 512, 605); ctx.font = '25px monospace'; ctx.fillText('WORLD ROCK PAPER SCISSORS LEAGUE', 512, 690);
    const decal = mesh(this.scene, new T.PlaneGeometry(6, 6), new T.MeshBasicMaterial({ map: new T.CanvasTexture(canvas), transparent: true, depthWrite: false }), 0, .015); decal.rotation.x = -Math.PI / 2;
    const postMat = mat('#2a2937'), ropeMat = new T.MeshStandardMaterial({ color: '#9f90bc', metalness: .65, roughness: .4 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8, b = ((i + 1) / 8) * Math.PI * 2 + Math.PI / 8;
      const x = Math.cos(a) * 5.5, z = Math.sin(a) * 5.5;
      mesh(this.scene, new T.CylinderGeometry(.1, .13, 1.8, 6), postMat, x, .8, z);
      const pad = box(this.scene, mat(i % 2 ? '#a490d0' : '#d8ef79'), [.24, .65, .24], [x, 1.22, z]); pad.rotation.y = -a;
      // Only rear ropes: keep the broadcast camera's view of combat unobstructed.
      if (z < 1 && Math.sin(b) * 5.5 < 1) for (const y of [.45, .9, 1.4]) {
        const p1 = new T.Vector3(x, y, z), p2 = new T.Vector3(Math.cos(b) * 5.5, y, Math.sin(b) * 5.5);
        const rope = mesh(this.scene, new T.CylinderGeometry(.025, .025, p1.distanceTo(p2), 5), ropeMat); rope.position.copy(p1.clone().add(p2).multiplyScalar(.5)); rope.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), p2.sub(p1).normalize());
      }
    }
    const crowd = new T.InstancedMesh(new T.CapsuleGeometry(.15, .32, 2, 5), mat('#252334'), 240), dummy = new T.Object3D();
    for (let i = 0; i < 240; i++) { const a = i * 2.399, row = i % 4; dummy.position.set(Math.cos(a) * (8 + row * 1.3), .6 + row * .65, Math.sin(a) * (8 + row * 1.3)); dummy.scale.setScalar(.8 + (i % 5) * .09); dummy.updateMatrix(); crowd.setMatrixAt(i, dummy.matrix); } this.scene.add(crowd);
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2, x = Math.cos(a) * 10, z = Math.sin(a) * 10;
      // Front lighting rigs obstruct a portrait broadcast camera. Keep supports behind the fighters.
      if (z < 2) box(this.scene, mat('#171522'), [.2, 7, .2], [x, 3, z]);
      for (let j = 0; j < 3; j++) box(this.scene, new T.MeshBasicMaterial({ color: i % 2 ? '#dacbff' : '#ffffdc' }), [.27, .18, .16], [x + (j - 1) * .4, 6.5, z]);
      const beam = mesh(this.scene, new T.ConeGeometry(1.7, 8, 16, 1, true), new T.MeshBasicMaterial({ color: i % 2 ? '#a283ff' : '#dce8ba', transparent: true, opacity: .025, side: T.DoubleSide, depthWrite: false }), x * .65, 3, z * .65); beam.rotation.z = Math.cos(a) * -.5; beam.rotation.x = Math.sin(a) * .5; this.beams.push(beam);
    }
    for (const side of [-1, 1]) { const s = mesh(this.scene, new T.CircleGeometry(.8, 24), new T.MeshBasicMaterial({ color: '#080810', transparent: true, opacity: .5, depthWrite: false }), side * 1.75, .025, 0); s.rotation.x = -Math.PI / 2; s.scale.y = .7; }
  }
  private createPortraits() {
    const scene = new T.Scene(); scene.add(new T.HemisphereLight('#ffffff', '#55516e', 3)); const light = new T.DirectionalLight('#ffffff', 4); light.position.set(-3, 5, 6); scene.add(light);
    const camera = new T.PerspectiveCamera(32, 180 / 220, .1, 30); camera.position.set(.8, 2.8, 5.2); camera.lookAt(0, 1.9, 0);
    this.renderer.setSize(180, 220); this.renderer.setClearColor('#17171e', 0);
    for (const f of FIGHTERS) { const rig = makeFighter(f); scene.add(rig.group); this.renderer.render(scene, camera); this.portraits[f.id] = this.renderer.domElement.toDataURL('image/png'); scene.remove(rig.group); dispose(rig.group); }
    this.renderer.setClearColor('#0b0b13', 1);
  }
  setFighters(player: Fighter, cpu: Fighter) {
    this.rigs.forEach(r => { this.scene.remove(r.group); dispose(r.group); }); this.rigs = [makeFighter(player), makeFighter(cpu)]; this.rigs.forEach(r => this.scene.add(r.group)); this.reset();
  }
  reset() { this.attack = null; dispose(this.effects); this.effects.clear(); this.rigs.forEach(r => { r.body.rotation.set(0, 0, 0); }); }
  enter() { this.reset(); this.mode = 'fight'; this.entrance = this.time; }
  celebrate(winner: number) { this.mode = 'winner'; this.winner = winner; this.reset(); }
  playAttack(result: RoundResult) {
    this.reset(); this.attack = { result, start: this.time };
    [result.player, result.cpu].forEach((move, i) => {
      if (result.winner !== 'draw' && (result.winner === 'player' ? 0 : 1) !== i) return;
      const effect = new T.Group(); effect.userData.side = i; effect.userData.move = move;
      if (move === 'rock') { const rock = mesh(effect, new T.DodecahedronGeometry(.7, 0), mat('#b4ae94', .4)); rock.rotation.set(.3, .7, .5); for (let j = 0; j < 6; j++) mesh(effect, new T.IcosahedronGeometry(.12, 0), mat('#d8fc52'), -.6 - j * .14, Math.sin(j) * .3, Math.cos(j) * .3); }
      if (move === 'paper') for (let j = 0; j < 7; j++) { const sheet = box(effect, new T.MeshStandardMaterial({ color: j % 2 ? '#d6fc65' : '#faf6de', side: T.DoubleSide, roughness: .8 }), [.8, .025, 1.15], [Math.sin(j * 1.5) * .55, j * .17 - .5, Math.cos(j * 1.5) * .55]); sheet.rotation.set(j * .45, j * .7, .5); }
      if (move === 'scissors') for (const d of [-1, 1]) { const blade = box(effect, new T.MeshStandardMaterial({ color: '#c4b4ff', emissive: '#8243ff', emissiveIntensity: 2, metalness: .6 }), [2.4, .1, .11], [0, 0, 0]); blade.rotation.z = d * .75; mesh(effect, new T.TorusGeometry(.28, .07, 6, 16), mat('#d8fc52'), -1, d * .7, 0); }
      this.effects.add(effect);
    });
    const sparkMat = new T.MeshBasicMaterial({ color: result.winner === 'draw' ? '#ffffff' : '#e7ff8b' });
    for (let i = 0; i < 30; i++) { const spark = mesh(this.effects, new T.SphereGeometry(.04, 4, 3), sparkMat); spark.userData.spark = i; }
  }
  private resize() { const w = this.host.clientWidth, h = this.host.clientHeight; this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  private frame() {
    const delta = Math.min(this.clock.getDelta(), .05); if (document.hidden) return; this.time += delta;
    const t = this.time, mobile = this.camera.aspect < .8, selecting = this.mode === 'select', home = this.mode === 'home';
    this.rigs.forEach((r, i) => {
      const side = i === 0 ? -1 : 1;
      r.group.visible = !selecting || i === 0;
      r.group.position.set(selecting ? 0 : side * 1.8, 0, 0);
      r.group.rotation.set(0, selecting ? .25 + Math.sin(t * .5) * .2 : -side * .75, 0);
      r.body.position.y = Math.sin(t * 3 + i) * .035;
      r.body.rotation.z = Math.sin(t * 2 + i) * .02;
      r.arms.forEach((arm, j) => { arm.rotation.x = -.3 + Math.sin(t * 3 + j) * .08; arm.rotation.z = j === 0 ? -.12 : .12; });
      r.legs.forEach(leg => leg.rotation.x = 0);
      if (this.mode === 'fight' && t - this.entrance < 1.8) { const p = Math.max(0, 1 - (t - this.entrance) / 1.8); r.group.position.x += side * p * 5; r.legs.forEach((leg, j) => leg.rotation.x = Math.sin(t * 12 + j * Math.PI) * .4 * p); }
      if (this.mode === 'winner' && i === this.winner) { r.arms.forEach((arm, j) => { arm.rotation.z = j === 0 ? -2.5 : 2.5; arm.rotation.x = -.3; }); r.group.position.y = Math.abs(Math.sin(t * 4)) * .15; r.group.rotation.y = .15 + Math.sin(t) * .2; }
      if (this.mode === 'winner' && i !== this.winner) { r.group.rotation.z = -side * 1.4; r.group.position.y = .3; }
    });
    let shake = 0;
    if (this.attack) {
      const elapsed = t - this.attack.start, result = this.attack.result, progress = Math.min(1, elapsed / .85);
      const winning = result.winner === 'player' ? 0 : 1;
      this.effects.children.forEach(effect => {
        if (effect.userData.spark !== undefined) { const j = effect.userData.spark, p = Math.max(0, elapsed - .72); effect.visible = p > 0 && p < 1.3; effect.position.set((result.winner === 'draw' ? 0 : winning === 0 ? 1.5 : -1.5) + Math.sin(j * 5) * p * 4, 1.7 + Math.cos(j * 3) * p * 3 - p * p, Math.cos(j * 7) * p * 3); return; }
        const side = effect.userData.side === 0 ? -1 : 1;
        effect.position.set(side * (1.6 - progress * (result.winner === 'draw' ? 1.6 : 3.1)), 1.7 + Math.sin(progress * Math.PI) * .6, .2);
        effect.rotation.set(elapsed * 2, elapsed * 3, elapsed * 2); effect.scale.setScalar(elapsed < 1 ? Math.min(1, elapsed * 5) : Math.max(0, 1 - (elapsed - 1) * 1.2));
        effect.visible = elapsed < 1.9;
      });
      this.rigs.forEach((r, i) => {
        const side = i === 0 ? -1 : 1, winner = result.winner === 'draw' || i === winning;
        if (winner) { r.arms[1].rotation.x = -1.4 * Math.sin(Math.min(elapsed * 3, Math.PI)); r.group.position.x -= side * Math.sin(Math.min(progress * Math.PI, Math.PI)) * .45; }
        else if (elapsed > .75) { const p = Math.min(1, (elapsed - .75) / (result.matchWinner ? 1.3 : .6)); r.group.position.x += side * p * 1.25; r.group.rotation.z = -side * p * (result.matchWinner ? 1.5 : .7); r.group.position.y = Math.sin(p * Math.PI) * .9; }
      });
      if (elapsed > .75 && elapsed < 1.05 && !this.reducedMotion) shake = .1 * (1 - (elapsed - .75) / .3);
    }
    if (selecting) { this.camTarget.set(mobile ? .4 : 1.6, 2.6, mobile ? 8.4 : 7); this.target.set(mobile ? 0 : 1.2, mobile ? .8 : 1.6, 0); }
    else if (this.mode === 'winner') { const x = this.winner === 0 ? -1.8 : 1.8; this.camTarget.set(x + .4, 3.3, mobile ? 10 : 8); this.target.set(x, mobile ? 1 : 1.5, 0); }
    else if (home) { this.camTarget.set(mobile ? 3 : 8 + Math.sin(t * .1) * 1.2, mobile ? 6.8 : 6, mobile ? 16.5 : 11); this.target.set(mobile ? 0 : -1.5, mobile ? 1 : 1.2, 0); }
    else { this.camTarget.set(mobile ? .4 : 1.5, mobile ? 5.7 : 4.4, mobile ? 15.5 : 11); this.target.set(0, mobile ? 1 : 1.2, 0); }
    this.camera.position.lerp(this.camTarget, this.reducedMotion ? 1 : .035); this.camera.position.x += Math.sin(t * 150) * shake; this.camera.position.y += Math.cos(t * 110) * shake;
    this.camera.lookAt(this.target); this.particles.rotation.y = t * .015; this.beams.forEach((b, i) => { if (!this.reducedMotion) b.rotation.z += Math.sin(t * .3 + i) * .0005; });
    this.renderer.render(this.scene, this.camera);
  }
  destroy() { this.renderer.setAnimationLoop(null); this.observer.disconnect(); dispose(this.scene); this.renderer.dispose(); }
}
