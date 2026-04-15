import { useRef, useMemo, useState, useEffect, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

interface AgentTask {
  id: string; title: string; description?: string
  type?: string; status?: string; priority?: string
}

// ─── World layout ─────────────────────────────────────────────────────────────
// Workstations: row1 (y=-3.2), row2 (y=0.8)
// Meeting table center: [0, 0, 3.5]
// Kitchen/break zone: [6.5, 0, 3.5]

const DESK_POSITIONS: Record<string, [number,number,number]> = {
  planner:  [-5.5, 0, -3.2],
  coder:    [-2.5, 0, -3.2],
  reviewer: [ 0.5, 0, -3.2],
  qa:       [ 3.5, 0, -3.2],
  devops:   [-5.5, 0,  0.8],
  analyst:  [-2.5, 0,  0.8],
  designer: [ 0.5, 0,  0.8],
  manager:  [ 3.5, 0,  0.8],
}
const CHAIR_OFFSET: [number,number,number] = [0, 0, 0.72] // in front of desk
const MEETING_CENTER: [number,number,number] = [0, 0, 3.6]
const KITCHEN_CENTER: [number,number,number] = [6.8, 0, 3.5]
const KITCHEN_SPOTS: [number,number,number][] = [
  [6.2, 0, 3.0], [7.0, 0, 3.1], [6.5, 0, 4.0], [7.2, 0, 3.8]
]
const MEETING_SPOTS: Record<string, [number,number,number]> = {
  analyst:  [-1.0, 0, 3.6],
  designer: [ 1.0, 0, 3.6],
  manager:  [ 0.0, 0, 2.5],
  qa:       [ 0.0, 0, 4.7],
  devops:   [-1.4, 0, 4.5],
  reviewer: [ 1.4, 0, 4.5],
}

// ─── Agent behavioral state machine ──────────────────────────────────────────
type BehaviorState = 'sitting' | 'rising' | 'walking' | 'arriving' | 'meeting' | 'kitchen' | 'stretching'
type Destination = 'desk' | 'meeting' | 'kitchen'

interface AgentBehavior {
  state: BehaviorState
  dest: Destination
  nextChangeAt: number   // world time seconds
  sitProgress: number    // 0=standing, 1=fully seated
  walkTarget: [number,number,number]
  facingTarget: number
}

const AGENT_COLORS: Record<string, string> = {
  planner: '#6366f1', coder: '#22d3ee', reviewer: '#a855f7', qa: '#34d399',
  devops: '#f59e0b', analyst: '#f87171', designer: '#e879f9', manager: '#fbbf24',
}
const AGENT_ROLES: Record<string, string> = {
  planner: 'Task Planner', coder: 'Code Writer', reviewer: 'Code Reviewer',
  qa: 'Quality Gate', devops: 'CI/CD', analyst: 'Data Analyst',
  designer: 'UI Designer', manager: 'Orchestrator',
}
const AGENT_NAMES: Record<string, string> = {
  planner: 'Планировщик', coder: 'Кодер', reviewer: 'Ревьюер',
  qa: 'QA', devops: 'DevOps', analyst: 'Аналитик',
  designer: 'Дизайнер', manager: 'Менеджер',
}
const AGENT_IDS = Object.keys(AGENT_COLORS)

function makeBehavior(agentId: string, elapsed: number): AgentBehavior {
  // stagger start times
  const offset = AGENT_IDS.indexOf(agentId) * 12
  return {
    state: 'sitting',
    dest: 'desk',
    nextChangeAt: elapsed + 20 + offset,
    sitProgress: 1,
    walkTarget: DESK_POSITIONS[agentId],
    facingTarget: 0,
  }
}

function nextDest(agentId: string, current: Destination): Destination {
  const r = Math.random()
  if (current === 'desk') {
    if (r < 0.45) return 'meeting'
    if (r < 0.65) return 'kitchen'
    return 'desk'
  }
  if (current === 'meeting') return r < 0.7 ? 'desk' : 'kitchen'
  return r < 0.8 ? 'desk' : 'meeting'
}

function getDestPos(agentId: string, dest: Destination): [number,number,number] {
  if (dest === 'desk') {
    const d = DESK_POSITIONS[agentId]
    return [d[0] + CHAIR_OFFSET[0], d[1], d[2] + CHAIR_OFFSET[2]]
  }
  if (dest === 'meeting') {
    return MEETING_SPOTS[agentId] ?? [MEETING_CENTER[0] + (Math.random()-0.5)*2, 0, MEETING_CENTER[2] + (Math.random()-0.5)*2]
  }
  const spot = KITCHEN_SPOTS[AGENT_IDS.indexOf(agentId) % KITCHEN_SPOTS.length]
  return spot
}

// ─── Camera ───────────────────────────────────────────────────────────────────
function CameraRig() {
  const { camera, gl } = useThree()
  const s = useRef({ drag: false, lx: 0, ly: 0, theta: -0.15, phi: 0.72, r: 14, tTheta: -0.15, tPhi: 0.72, tR: 14 })
  useEffect(() => {
    const el = gl.domElement
    const dn = (e: MouseEvent) => { if (e.button !== 0) return; s.current.drag = true; s.current.lx = e.clientX; s.current.ly = e.clientY }
    const up = () => { s.current.drag = false }
    const mv = (e: MouseEvent) => {
      if (!s.current.drag) return
      s.current.tTheta -= (e.clientX - s.current.lx) * 0.007
      s.current.tPhi = Math.max(0.22, Math.min(1.3, s.current.tPhi + (e.clientY - s.current.ly) * 0.007))
      s.current.lx = e.clientX; s.current.ly = e.clientY
    }
    const wh = (e: WheelEvent) => { e.preventDefault(); s.current.tR = Math.max(4, Math.min(22, s.current.tR + e.deltaY * 0.015)) }
    el.addEventListener('mousedown', dn); window.addEventListener('mouseup', up); window.addEventListener('mousemove', mv)
    el.addEventListener('wheel', wh, { passive: false })
    return () => { el.removeEventListener('mousedown', dn); window.removeEventListener('mouseup', up); window.removeEventListener('mousemove', mv); el.removeEventListener('wheel', wh) }
  }, [gl])
  useFrame(() => {
    const d = s.current; const k = 0.08
    d.theta += (d.tTheta - d.theta) * k; d.phi += (d.tPhi - d.phi) * k; d.r += (d.tR - d.r) * k
    camera.position.set(d.r * Math.sin(d.phi) * Math.sin(d.theta), d.r * Math.cos(d.phi) + 0.5, d.r * Math.sin(d.phi) * Math.cos(d.theta))
    camera.lookAt(0, 0.8, 0)
  })
  return null
}

// ─── Room ─────────────────────────────────────────────────────────────────────
function Room() {
  const tiles = useMemo(() => {
    const t: JSX.Element[] = []
    for (let xi = 0; xi < 9; xi++) for (let zi = 0; zi < 8; zi++)
      t.push(<mesh key={`${xi}${zi}`} rotation={[-Math.PI/2,0,0]} position={[xi*2-8, 0.001, zi*2-7]}>
        <planeGeometry args={[1.92,1.92]} />
        <meshStandardMaterial color={(xi+zi)%2===0 ? '#a0906e' : '#7a6a50'} roughness={0.9} />
      </mesh>)
    return t
  }, [])
  return (
    <group>
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,0,0]} receiveShadow>
        <planeGeometry args={[20,16]} /><meshStandardMaterial color="#8b7355" roughness={1} />
      </mesh>
      {tiles}
      {/* Ceiling */}
      <mesh rotation={[Math.PI/2,0,0]} position={[0,4,0]}>
        <planeGeometry args={[20,16]} /><meshStandardMaterial color="#e8e0d5" roughness={1} />
      </mesh>
      {/* Walls */}
      <mesh position={[0,2,-8]} receiveShadow><planeGeometry args={[20,4]} /><meshStandardMaterial color="#d4c9bc" roughness={0.9} /></mesh>
      <mesh position={[-10,2,0]} rotation={[0,Math.PI/2,0]}><planeGeometry args={[16,4]} /><meshStandardMaterial color="#ccc3b5" roughness={0.9} /></mesh>
      <mesh position={[10,2,0]} rotation={[0,-Math.PI/2,0]}><planeGeometry args={[16,4]} /><meshStandardMaterial color="#ccc3b5" roughness={0.9} /></mesh>
      <mesh position={[0,2,8]}><planeGeometry args={[20,4]} /><meshStandardMaterial color="#d4c9bc" roughness={0.9} /></mesh>
      {/* Windows back wall */}
      {([-4.5, 0, 4.5] as number[]).map(x => (
        <group key={x} position={[x, 2.3, -7.97]}>
          <mesh><planeGeometry args={[2.4,1.6]} /><meshStandardMaterial color="#6baed6" emissive="#87ceeb" emissiveIntensity={0.25} transparent opacity={0.75} /></mesh>
          <mesh position={[0,0,-0.01]}><planeGeometry args={[2.5,1.7]} /><meshStandardMaterial color="#7a6248" /></mesh>
          <mesh position={[0,0,0.01]}><planeGeometry args={[2.4,1.6]} /><meshStandardMaterial color="#6baed6" emissive="#87ceeb" emissiveIntensity={0.25} transparent opacity={0.75} /></mesh>
          <pointLight position={[0,0,0.6]} color="#fff8e1" intensity={1.2} distance={6} />
        </group>
      ))}
      {/* Baseboard */}
      <mesh position={[0,0.06,-7.96]}><boxGeometry args={[20,0.12,0.05]} /><meshStandardMaterial color="#6b5b45" /></mesh>
      <mesh position={[-9.96,0.06,0]} rotation={[0,Math.PI/2,0]}><boxGeometry args={[16,0.12,0.05]} /><meshStandardMaterial color="#6b5b45" /></mesh>
    </group>
  )
}

// ─── Furniture ────────────────────────────────────────────────────────────────
function Desk({ pos, color }: { pos: [number,number,number]; color: string }) {
  return (
    <group position={pos}>
      <mesh position={[0,0.74,0]} castShadow receiveShadow>
        <boxGeometry args={[1.35,0.04,0.72]} /><meshStandardMaterial color="#c8b89a" roughness={0.4} metalness={0.1} />
      </mesh>
      {([-0.61,0.61] as number[]).flatMap(x => ([-0.3,0.3] as number[]).map(z => (
        <mesh key={`${x}${z}`} position={[x,0.37,z]} castShadow>
          <boxGeometry args={[0.05,0.74,0.05]} /><meshStandardMaterial color="#8b7355" />
        </mesh>
      )))}
      <mesh position={[0,1.12,-0.28]} castShadow>
        <boxGeometry args={[0.6,0.37,0.03]} /><meshStandardMaterial color="#111" roughness={0.3} metalness={0.8} />
      </mesh>
      <mesh position={[0,1.12,-0.26]}>
        <planeGeometry args={[0.54,0.31]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.55} transparent opacity={0.9} />
      </mesh>
      <mesh position={[0,0.87,-0.24]}><boxGeometry args={[0.07,0.26,0.07]} /><meshStandardMaterial color="#222" metalness={0.7} /></mesh>
      <mesh position={[0,0.77,0.1]}><boxGeometry args={[0.48,0.02,0.16]} /><meshStandardMaterial color="#222" roughness={0.5} /></mesh>
      <mesh position={[0.32,0.78,0.22]}><boxGeometry args={[0.1,0.02,0.12]} /><meshStandardMaterial color="#555" /></mesh>
      <pointLight position={[0,1,-0.1]} color={color} intensity={0.35} distance={1.8} />
    </group>
  )
}

function Chair({ pos, rotation=0 }: { pos: [number,number,number]; rotation?: number }) {
  return (
    <group position={pos} rotation={[0,rotation,0]}>
      <mesh position={[0,0.44,0]} castShadow><boxGeometry args={[0.46,0.06,0.46]} /><meshStandardMaterial color="#2d3a5c" roughness={0.8} /></mesh>
      <mesh position={[0,0.8,-0.2]} castShadow><boxGeometry args={[0.46,0.6,0.06]} /><meshStandardMaterial color="#2d3a5c" roughness={0.8} /></mesh>
      {([-0.24,0.24] as number[]).map(x => <mesh key={x} position={[x,0.58,0]}><boxGeometry args={[0.04,0.04,0.44]} /><meshStandardMaterial color="#222" /></mesh>)}
      <mesh position={[0,0.22,0]}><cylinderGeometry args={[0.04,0.04,0.44,8]} /><meshStandardMaterial color="#111" metalness={0.8} /></mesh>
      <mesh position={[0,0.05,0]}><cylinderGeometry args={[0.22,0.22,0.04,5]} /><meshStandardMaterial color="#111" metalness={0.7} /></mesh>
    </group>
  )
}

function MeetingTable() {
  return (
    <group position={MEETING_CENTER}>
      <mesh position={[0,0.73,0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.5,1.5,0.06,32]} /><meshStandardMaterial color="#c8b89a" roughness={0.3} metalness={0.1} />
      </mesh>
      <mesh position={[0,0.36,0]}><cylinderGeometry args={[0.06,0.08,0.73,8]} /><meshStandardMaterial color="#8b7355" /></mesh>
      <mesh position={[0,0.04,0]}><cylinderGeometry args={[0.52,0.52,0.06,16]} /><meshStandardMaterial color="#6b5b45" /></mesh>
      <mesh position={[0,2.8,0]}><cylinderGeometry args={[0.2,0.32,0.14,16]} /><meshStandardMaterial color="#e8d5a0" emissive="#fff8e1" emissiveIntensity={0.9} /></mesh>
      <pointLight position={[0,2.6,0]} color="#fff8e1" intensity={2.5} distance={4.5} castShadow />
    </group>
  )
}

function Kitchen() {
  return (
    <group position={[6.5, 0, 3.5]}>
      {/* Counter */}
      <mesh position={[0,0.9,0]} castShadow receiveShadow>
        <boxGeometry args={[2.2,0.06,0.7]} /><meshStandardMaterial color="#d2b896" roughness={0.4} />
      </mesh>
      <mesh position={[0,0.44,0]} castShadow>
        <boxGeometry args={[2.2,0.88,0.7]} /><meshStandardMaterial color="#b0956e" roughness={0.6} />
      </mesh>
      {/* Cabinet above */}
      <mesh position={[0,2.4,0.05]} castShadow>
        <boxGeometry args={[2.2,0.8,0.5]} /><meshStandardMaterial color="#c8a87a" roughness={0.5} />
      </mesh>
      {/* Coffee machine */}
      <mesh position={[-0.7,1.08,0.1]} castShadow>
        <boxGeometry args={[0.28,0.36,0.28]} /><meshStandardMaterial color="#222" roughness={0.3} metalness={0.6} />
      </mesh>
      <mesh position={[-0.7,1.1,0.24]}>
        <circleGeometry args={[0.06,12]} /><meshStandardMaterial color="#e74c3c" emissive="#e74c3c" emissiveIntensity={0.8} />
      </mesh>
      {/* Mugs */}
      {([-0.1, 0.2, 0.5] as number[]).map((x, i) => (
        <group key={x} position={[x, 0.96, 0.1]}>
          <mesh><cylinderGeometry args={[0.045,0.04,0.09,10]} /><meshStandardMaterial color={['#e74c3c','#3498db','#2ecc71'][i]} /></mesh>
        </group>
      ))}
      {/* Plant */}
      <mesh position={[0.85,0.98,0.1]} castShadow><cylinderGeometry args={[0.1,0.07,0.22,10]} /><meshStandardMaterial color="#c1440e" roughness={0.9} /></mesh>
      <mesh position={[0.85,1.2,0.1]} castShadow><sphereGeometry args={[0.18,8,6]} /><meshStandardMaterial color="#2d8a4e" roughness={1} /></mesh>
      {/* Couch */}
      <mesh position={[0,-0.02,-1.4]} castShadow>
        <boxGeometry args={[2,0.44,0.8]} /><meshStandardMaterial color="#4a5568" roughness={0.9} />
      </mesh>
      <mesh position={[0,0.36,-1.75]} castShadow>
        <boxGeometry args={[2,0.5,0.12]} /><meshStandardMaterial color="#4a5568" roughness={0.9} />
      </mesh>
      {[-0.85,0.85].map(x => <mesh key={x} position={[x,0.28,-1.4]} castShadow><boxGeometry args={[0.12,0.36,0.8]} /><meshStandardMaterial color="#4a5568" roughness={0.9} /></mesh>)}
      {/* Coffee table */}
      <mesh position={[0,0.3,-0.8]} castShadow>
        <boxGeometry args={[0.9,0.06,0.5]} /><meshStandardMaterial color="#8b7355" roughness={0.4} />
      </mesh>
      {[[-0.35,-0.18],[-0.35,0.18],[0.35,-0.18],[0.35,0.18]].map(([x,z],i)=>(
        <mesh key={i} position={[x,0.15,z+(-0.8)]} castShadow><boxGeometry args={[0.04,0.3,0.04]} /><meshStandardMaterial color="#6b5b45" /></mesh>
      ))}
      <pointLight position={[0,1.8,0]} color="#ffcc80" intensity={0.8} distance={3} />
    </group>
  )
}

function Bookshelf({ pos }: { pos: [number,number,number] }) {
  return (
    <group position={pos}>
      <mesh position={[0,1.5,0]} castShadow><boxGeometry args={[1.2,3,0.3]} /><meshStandardMaterial color="#8b7355" roughness={0.6} /></mesh>
      {[0.5,1.1,1.7,2.3].map(y => <mesh key={y} position={[0,y,0.02]}><boxGeometry args={[1.1,0.04,0.28]} /><meshStandardMaterial color="#6b5b45" /></mesh>)}
      {[0.5,1.1,1.7].map((y,si) => Array.from({length:6},(_,bi)=>(
        <mesh key={`${y}-${bi}`} position={[-0.42+bi*0.16,y+0.18,0]} castShadow>
          <boxGeometry args={[0.12,0.32,0.22]} /><meshStandardMaterial color={['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c'][bi]} roughness={0.8} />
        </mesh>
      )))}
    </group>
  )
}

function CeilingLight({ pos }: { pos: [number,number,number] }) {
  return (
    <group position={pos}>
      <mesh><boxGeometry args={[0.75,0.04,0.22]} /><meshStandardMaterial color="#e8e0d5" emissive="#fff8e1" emissiveIntensity={0.75} /></mesh>
      <pointLight color="#fff8e1" intensity={1.0} distance={5.5} castShadow />
    </group>
  )
}

function Plant({ pos }: { pos: [number,number,number] }) {
  return (
    <group position={pos}>
      <mesh position={[0,0.2,0]}><cylinderGeometry args={[0.16,0.11,0.3,12]} /><meshStandardMaterial color="#c1440e" roughness={0.9} /></mesh>
      <mesh position={[0,0.48,0]}><sphereGeometry args={[0.24,10,8]} /><meshStandardMaterial color="#2d8a4e" roughness={1} /></mesh>
    </group>
  )
}

// ─── Human body ───────────────────────────────────────────────────────────────
interface HumanProps {
  agentId: string
  isActive: boolean
  onClick: () => void
  taskStatus?: string
  sitAmount: number        // 0=stand, 1=fully sitting
  currentDest: Destination
  isSpeaking?: boolean
}

function Human({ agentId, isActive, onClick, sitAmount, currentDest, isSpeaking }: HumanProps) {
  const color = AGENT_COLORS[agentId]
  const group = useRef<THREE.Group>(null!)
  const lArm = useRef<THREE.Mesh>(null!)
  const rArm = useRef<THREE.Mesh>(null!)
  const lLeg = useRef<THREE.Mesh>(null!)
  const rLeg = useRef<THREE.Mesh>(null!)
  const head = useRef<THREE.Mesh>(null!)
  const torso = useRef<THREE.Group>(null!)
  const hovered = useRef(false)
  const t = useRef(Math.random() * Math.PI * 2)

  useFrame((_, dt) => {
    t.current += dt
    const tc = t.current
    if (!group.current) return

    const isSitting = sitAmount > 0.5
    const isWalking = sitAmount < 0.1 && currentDest !== 'kitchen'
    const isRelaxing = currentDest === 'kitchen' && sitAmount < 0.3

    // Sitting: lower body, bend torso
    const seatY = -sitAmount * 0.38
    if (torso.current) {
      torso.current.position.y = seatY
      torso.current.rotation.x = isSitting ? 0.08 : 0
    }

    // Arm animation
    const armSpeed = isWalking ? 5 : isSitting ? 2 : 0.8
    const armAmp = isWalking ? 0.55 : isSitting ? 0.2 : 0.08
    if (lArm.current) lArm.current.rotation.x = Math.sin(tc * armSpeed) * armAmp + (isSitting ? -0.35 : 0)
    if (rArm.current) rArm.current.rotation.x = -Math.sin(tc * armSpeed) * armAmp + (isSitting ? -0.35 : 0)

    // Leg animation
    const legAmp = isWalking ? 0.42 : 0
    if (lLeg.current) lLeg.current.rotation.x = Math.sin(tc * 5) * legAmp
    if (rLeg.current) rLeg.current.rotation.x = -Math.sin(tc * 5) * legAmp

    // Head
    if (head.current) {
      if (isSitting && currentDest === 'desk') {
        head.current.rotation.x = -0.28 + Math.sin(tc * 0.4) * 0.04 // looking at screen
        head.current.rotation.y = Math.sin(tc * 0.3) * 0.05
      } else if (currentDest === 'meeting') {
        head.current.rotation.y = Math.sin(tc * 0.7) * 0.35 // looking around table
        head.current.rotation.x = Math.sin(tc * 0.4) * 0.06
      } else if (isRelaxing) {
        head.current.rotation.y = Math.sin(tc * 0.4) * 0.25
        head.current.rotation.x = -0.12
      } else {
        head.current.rotation.x = 0
        head.current.rotation.y = 0
      }
    }

    // Speaking bounce
    if (isSpeaking && head.current) {
      head.current.position.y = 0.93 + Math.abs(Math.sin(tc * 8)) * 0.015
    } else if (head.current) {
      head.current.position.y = 0.93
    }

    // Scale hover
    const tgt = (hovered.current || isActive) ? 1.07 : 1
    const ns = group.current.scale.x + (tgt - group.current.scale.x) * 0.1
    group.current.scale.setScalar(ns)
  })

  const skinColor = '#f5c18a'
  const pantsColor = '#2c3e50'

  return (
    <group
      ref={group}
      onClick={e => { e.stopPropagation(); onClick() }}
      onPointerOver={() => { hovered.current = true; document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { hovered.current = false; document.body.style.cursor = 'auto' }}
    >
      {/* Shadow */}
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,0.003,0]}>
        <circleGeometry args={[0.2,14]} /><meshStandardMaterial color="#000" transparent opacity={0.12} />
      </mesh>

      {/* Torso group (moves down when sitting) */}
      <group ref={torso}>
        {/* Legs */}
        <mesh ref={lLeg} position={[-0.09,0.28,0]} castShadow>
          <boxGeometry args={[0.1,0.56,0.1]} /><meshStandardMaterial color={pantsColor} roughness={0.8} />
        </mesh>
        <mesh ref={rLeg} position={[0.09,0.28,0]} castShadow>
          <boxGeometry args={[0.1,0.56,0.1]} /><meshStandardMaterial color={pantsColor} roughness={0.8} />
        </mesh>
        {/* Shoes */}
        {([-0.09,0.09] as number[]).map(x => (
          <mesh key={x} position={[x,0.04,0.04]} castShadow>
            <boxGeometry args={[0.11,0.08,0.18]} /><meshStandardMaterial color="#1a1a2e" />
          </mesh>
        ))}
        {/* Shirt/torso */}
        <mesh position={[0,0.8,0]} castShadow>
          <boxGeometry args={[0.28,0.38,0.16]} /><meshStandardMaterial color={color} roughness={0.6} />
        </mesh>
        {/* Collar */}
        <mesh position={[0,0.97,0.07]}>
          <boxGeometry args={[0.13,0.06,0.04]} /><meshStandardMaterial color="#fff" />
        </mesh>
        {/* Arms */}
        <mesh ref={lArm} position={[-0.2,0.8,0]} castShadow>
          <boxGeometry args={[0.09,0.36,0.09]} /><meshStandardMaterial color={color} roughness={0.6} />
        </mesh>
        <mesh ref={rArm} position={[0.2,0.8,0]} castShadow>
          <boxGeometry args={[0.09,0.36,0.09]} /><meshStandardMaterial color={color} roughness={0.6} />
        </mesh>
        {/* Hands */}
        {([-0.2,0.2] as number[]).map(x => (
          <mesh key={x} position={[x,0.61,0]}><boxGeometry args={[0.09,0.09,0.09]} /><meshStandardMaterial color={skinColor} roughness={0.8} /></mesh>
        ))}
        {/* Neck */}
        <mesh position={[0,1.04,0]}><boxGeometry args={[0.1,0.09,0.09]} /><meshStandardMaterial color={skinColor} roughness={0.8} /></mesh>
        {/* Head */}
        <mesh ref={head} position={[0,1.22,0]} castShadow>
          <boxGeometry args={[0.23,0.25,0.21]} /><meshStandardMaterial color={skinColor} roughness={0.8} />
        </mesh>
        {/* Eyes */}
        {([-0.07,0.07] as number[]).map(x => (
          <mesh key={x} position={[x,1.24,0.107]}>
            <sphereGeometry args={[0.027,8,8]} /><meshStandardMaterial color="#1a1a2e" />
          </mesh>
        ))}
        {/* Pupils glow */}
        {([-0.07,0.07] as number[]).map(x => (
          <mesh key={x} position={[x,1.24,0.133]}>
            <sphereGeometry args={[0.013,6,6]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} />
          </mesh>
        ))}
        {/* Hair */}
        <mesh position={[0,1.35,0]}><boxGeometry args={[0.24,0.08,0.22]} /><meshStandardMaterial color="#2c1810" roughness={1} /></mesh>
        {/* Name tag */}
        <mesh position={[0,1.6,0]}>
          <planeGeometry args={[0.4,0.1]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={isActive ? 1.8 : 0.6} transparent opacity={0.9} />
        </mesh>
        {/* Speaking bubble */}
        {isSpeaking && (
          <mesh position={[0.2,1.55,0.1]}>
            <sphereGeometry args={[0.06,8,8]} /><meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={1.5} transparent opacity={0.9} />
          </mesh>
        )}
        {isActive && <pointLight color={color} intensity={1.8} distance={2} position={[0,0.8,0]} />}
      </group>
    </group>
  )
}

// ─── Autonomous Agent ─────────────────────────────────────────────────────────
function AutonomousAgent({
  agentId, isActive, onClick, taskStatus, taskLogs
}: {
  agentId: string; isActive: boolean; onClick: () => void
  taskStatus?: string; taskLogs: string[]
}) {
  const group = useRef<THREE.Group>(null!)
  const beh = useRef<AgentBehavior | null>(null)
  const elapsed = useRef(0)

  // Detect if this agent has recent log activity
  const isSpeaking = useMemo(() => {
    const kw = agentId.toLowerCase()
    return taskLogs.slice(-6).some(l => l.toLowerCase().includes(kw) || l.toLowerCase().includes(AGENT_ROLES[agentId].toLowerCase().split(' ')[0].toLowerCase()))
  }, [taskLogs, agentId])

  useFrame((_, dt) => {
    elapsed.current += dt
    const now = elapsed.current
    if (!group.current) return

    // Init behavior
    if (!beh.current) {
      beh.current = makeBehavior(agentId, now)
      const deskPos = DESK_POSITIONS[agentId]
      const chairPos: [number,number,number] = [deskPos[0], 0, deskPos[2] + 0.72]
      group.current.position.set(...chairPos)
    }

    const b = beh.current

    if (b.state === 'sitting') {
      // Smoothly increase sit amount
      b.sitProgress = Math.min(1, b.sitProgress + dt * 2.5)
      if (now >= b.nextChangeAt) {
        // Time to get up
        b.state = 'rising'
      }
    }
    else if (b.state === 'rising') {
      b.sitProgress = Math.max(0, b.sitProgress - dt * 2.5)
      if (b.sitProgress <= 0) {
        // Choose next destination
        const newDest = nextDest(agentId, b.dest)
        b.dest = newDest
        b.walkTarget = getDestPos(agentId, newDest)
        // Face toward target
        const dx = b.walkTarget[0] - group.current.position.x
        const dz = b.walkTarget[2] - group.current.position.z
        b.facingTarget = Math.atan2(dx, dz)
        b.state = 'walking'
      }
    }
    else if (b.state === 'walking') {
      const pos = group.current.position
      const tx = b.walkTarget[0], tz = b.walkTarget[2]
      const dx = tx - pos.x, dz = tz - pos.z
      const dist = Math.sqrt(dx*dx + dz*dz)

      // Rotate to face direction
      const targetRot = Math.atan2(dx, dz)
      let curRot = group.current.rotation.y
      let diff = targetRot - curRot
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      group.current.rotation.y += diff * 0.12

      if (dist > 0.08) {
        const speed = 1.4
        pos.x += (dx/dist) * speed * dt
        pos.z += (dz/dist) * speed * dt
      } else {
        // Arrived
        pos.set(tx, 0, tz)
        b.state = 'arriving'
        b.sitProgress = 0
      }
    }
    else if (b.state === 'arriving') {
      if (b.dest === 'desk') {
        // Face screen (toward desk y=-3.2 means face -Z direction = PI)
        const deskZ = DESK_POSITIONS[agentId][2]
        const facingDesk = deskZ < 0 ? Math.PI : 0
        let diff = facingDesk - group.current.rotation.y
        while (diff > Math.PI) diff -= Math.PI * 2
        while (diff < -Math.PI) diff += Math.PI * 2
        group.current.rotation.y += diff * 0.1
        b.sitProgress = Math.min(1, b.sitProgress + dt * 2)
        if (b.sitProgress >= 1) {
          b.state = 'sitting'
          const stayTime = 25 + Math.random() * 40
          b.nextChangeAt = now + stayTime
        }
      } else if (b.dest === 'meeting') {
        // Face meeting center
        const dx = MEETING_CENTER[0] - group.current.position.x
        const dz = MEETING_CENTER[2] - group.current.position.z
        const targetRot = Math.atan2(dx, dz)
        let diff = targetRot - group.current.rotation.y
        while (diff > Math.PI) diff -= Math.PI * 2
        while (diff < -Math.PI) diff += Math.PI * 2
        group.current.rotation.y += diff * 0.1
        b.state = 'meeting'
        b.sitProgress = 0
        b.nextChangeAt = now + 15 + Math.random() * 20
      } else if (b.dest === 'kitchen') {
        b.state = 'kitchen'
        b.sitProgress = 0
        b.nextChangeAt = now + 10 + Math.random() * 15
      }
    }
    else if (b.state === 'meeting') {
      // Slowly look around
      const dx = MEETING_CENTER[0] - group.current.position.x
      const dz = MEETING_CENTER[2] - group.current.position.z
      const baseRot = Math.atan2(dx, dz)
      group.current.rotation.y += (baseRot - group.current.rotation.y) * 0.02
      if (now >= b.nextChangeAt) {
        b.state = 'rising'; b.sitProgress = 0
      }
    }
    else if (b.state === 'kitchen') {
      // Relaxing at kitchen
      b.sitProgress = 0
      if (now >= b.nextChangeAt) {
        b.state = 'rising'; b.sitProgress = 0
      }
    }
  })

  // Compute sit amount from behavior state
  const [sitAmt, setSitAmt] = useState(1)
  const [dest, setDest] = useState<Destination>('desk')

  useFrame(() => {
    if (beh.current) {
      setSitAmt(beh.current.sitProgress)
      setDest(beh.current.dest)
    }
  })

  const taskActive = taskStatus === 'running' || taskStatus === 'queued'

  return (
    <group ref={group}>
      <Human
        agentId={agentId}
        isActive={isActive}
        onClick={onClick}
        sitAmount={sitAmt}
        currentDest={dest}
        taskStatus={taskStatus}
        isSpeaking={isSpeaking || (taskActive && agentId === 'coder')}
      />
      {/* Active task pulse ring */}
      {taskActive && (
        <PulseRing color={AGENT_COLORS[agentId]} />
      )}
    </group>
  )
}

function PulseRing({ color }: { color: string }) {
  const m = useRef<THREE.Mesh>(null!)
  const t = useRef(0)
  useFrame((_, dt) => {
    t.current += dt * 2
    if (!m.current) return
    m.current.scale.setScalar(1 + Math.sin(t.current) * 0.35)
    ;(m.current.material as THREE.MeshStandardMaterial).opacity = 0.55 - Math.sin(t.current) * 0.22
  })
  return (
    <mesh ref={m} position={[0,0.003,0]} rotation={[-Math.PI/2,0,0]}>
      <ringGeometry args={[0.22,0.3,20]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2} transparent opacity={0.55} />
    </mesh>
  )
}

// ─── Scene ────────────────────────────────────────────────────────────────────
function Scene({ task, activeAgentId, onAgentClick, taskLogs }: {
  task: AgentTask; activeAgentId: string | null
  onAgentClick: (id: string) => void; taskLogs: string[]
}) {
  const statusColor = task.status === 'running' ? '#22d3ee' : task.status === 'completed' ? '#34d399' : task.status === 'failed' ? '#e74c3c' : '#6366f1'

  return (
    <>
      <CameraRig />
      <ambientLight intensity={0.45} color="#fff8f0" />
      <directionalLight position={[4, 8, 2]} intensity={0.55} color="#fff8e1" castShadow
        shadow-mapSize={[1024,1024]} shadow-camera-left={-12} shadow-camera-right={12}
        shadow-camera-top={10} shadow-camera-bottom={-8} shadow-camera-near={0.5} shadow-camera-far={30}
      />

      {/* Ceiling lights */}
      {([-6,-3,0,3,6] as number[]).flatMap(x =>
        ([-2,1.5] as number[]).map(z => <CeilingLight key={`${x}${z}`} pos={[x,3.93,z]} />)
      )}

      <Room />
      <Kitchen />
      <MeetingTable />

      {/* Workstations */}
      {AGENT_IDS.map(id => {
        const d = DESK_POSITIONS[id]
        const chairFacing = d[2] < 0 ? Math.PI : 0
        const chairZ = d[2] < 0 ? d[2] + 0.72 : d[2] - 0.72
        return (
          <group key={id}>
            <Desk pos={d} color={AGENT_COLORS[id]} />
            <Chair pos={[d[0], 0, chairZ]} rotation={chairFacing} />
          </group>
        )
      })}

      {/* Bookshelves on right wall */}
      <Bookshelf pos={[9.2, 0, -4]} />
      <Bookshelf pos={[9.2, 0, 0]} />

      {/* Plants */}
      <Plant pos={[-9.3, 0, 6.5]} />
      <Plant pos={[4, 0, -7.2]} />

      {/* Meeting chairs around table */}
      {Object.values(MEETING_SPOTS).map((p, i) => (
        <Chair key={i} pos={p} rotation={Math.atan2(MEETING_CENTER[0]-p[0], MEETING_CENTER[2]-p[2])} />
      ))}

      {/* Status board on left wall */}
      <group position={[-9.85, 2.5, -3]} rotation={[0, Math.PI/2, 0]}>
        <mesh><boxGeometry args={[0.06,1.8,2.6]} /><meshStandardMaterial color="#5a4a3a" /></mesh>
        <mesh position={[0.05,0,0]}><planeGeometry args={[2.4,1.6]} /><meshStandardMaterial color="#111827" /></mesh>
        <mesh position={[0.06,0.5,0]}><planeGeometry args={[2.0,0.2]} /><meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={0.7} /></mesh>
        {[-0.1,-0.4,-0.7].map((y,i) => <mesh key={y} position={[0.06,y,i*0.1-0.2]}><planeGeometry args={[i===0?1.8:1.3,0.06]} /><meshStandardMaterial color="#fff" transparent opacity={0.35-i*0.08} /></mesh>)}
        <pointLight position={[0.4,0,0]} color={statusColor} intensity={0.7} distance={2.5} />
      </group>

      {/* Agents */}
      {AGENT_IDS.map(id => (
        <AutonomousAgent
          key={id}
          agentId={id}
          isActive={id === activeAgentId}
          onClick={() => onAgentClick(id)}
          taskStatus={task.status}
          taskLogs={taskLogs}
        />
      ))}
    </>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AgentOffice3D({ task }: { task: AgentTask }) {
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const [taskLogs, setTaskLogs] = useState<string[]>([])
  const activeAgent = activeAgentId ? { id: activeAgentId, name: AGENT_NAMES[activeAgentId], role: AGENT_ROLES[activeAgentId], color: AGENT_COLORS[activeAgentId] } : null

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const token = localStorage.getItem('authToken') || sessionStorage.getItem('authToken') || ''
        const res = await fetch(`/api/v1/agent-tasks/${task.id}/logs`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data.logs) {
          setTaskLogs((data.logs as any[]).map((l: any) => typeof l === 'string' ? l : (l.msg || l.message || JSON.stringify(l))))
        }
      } catch { /* silent */ }
    }
    poll()
    const iv = setInterval(poll, 3000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [task.id])

  const handleClick = useCallback((id: string) => setActiveAgentId(p => p === id ? null : id), [])

  const statusColor = task.status === 'running' ? '#22d3ee' : task.status === 'completed' ? '#34d399' : task.status === 'failed' ? '#e74c3c' : '#6366f1'
  const statusLabel = task.status === 'running' ? 'ВЫПОЛНЯЕТСЯ' : task.status === 'completed' ? 'ГОТОВО' : task.status === 'failed' ? 'ОШИБКА' : 'В ОЧЕРЕДИ'

  return (
    <div style={{ width:'100%', height:'100%', position:'relative', background:'#b8c8d4', fontFamily:'system-ui,sans-serif' }}>
      <Canvas shadows camera={{ position:[0,7,13], fov:50 }}
        gl={{ antialias:true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure:1.15 }}>
        <Scene task={task} activeAgentId={activeAgentId} onAgentClick={handleClick} taskLogs={taskLogs} />
      </Canvas>

      {/* Task info */}
      <div style={{ position:'absolute', top:10, left:10, background:'rgba(255,255,255,0.93)', border:`2px solid ${statusColor}`, borderRadius:10, padding:'8px 14px', maxWidth:230, boxShadow:'0 2px 12px rgba(0,0,0,0.15)' }}>
        <div style={{ fontSize:13, fontWeight:700, color:'#1a1a2e', marginBottom:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{task.title}</div>
        <div style={{ fontSize:11, fontWeight:600, color:statusColor, display:'flex', alignItems:'center', gap:5 }}>
          <span style={{ width:7, height:7, borderRadius:'50%', background:statusColor, display:'inline-block', boxShadow:`0 0 5px ${statusColor}` }} />
          {statusLabel}
        </div>
      </div>

      {/* Agent legend */}
      <div style={{ position:'absolute', top:10, right:10, background:'rgba(255,255,255,0.9)', borderRadius:10, padding:'8px 12px', boxShadow:'0 2px 12px rgba(0,0,0,0.12)' }}>
        {AGENT_IDS.map(id => (
          <div key={id} onClick={() => handleClick(id)} style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color:'#1a1a2e', cursor:'pointer', padding:'2px 0', fontWeight: activeAgentId===id ? 700 : 400 }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:AGENT_COLORS[id], flexShrink:0 }} />
            {AGENT_NAMES[id]}
          </div>
        ))}
      </div>

      {/* Live logs */}
      {taskLogs.length > 0 && (
        <div style={{ position:'absolute', bottom: activeAgent ? 98 : 10, left:10, right:10, background:'rgba(255,255,255,0.9)', borderRadius:10, padding:'7px 12px', maxHeight:74, overflow:'hidden', boxShadow:'0 2px 12px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize:10, fontWeight:700, color:'#6366f1', marginBottom:3 }}>ЛОГИ ЗАДАЧИ</div>
          {taskLogs.slice(-3).map((l,i) => <div key={i} style={{ fontSize:10, color:'#444', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{l}</div>)}
        </div>
      )}

      {/* Hint */}
      <div style={{ position:'absolute', bottom: activeAgent ? 96 : 8, left:'50%', transform:'translateX(-50%)', fontSize:10, color:'rgba(0,0,0,0.35)', pointerEvents:'none', whiteSpace:'nowrap', background:'rgba(255,255,255,0.6)', padding:'2px 8px', borderRadius:6 }}>
        Тяни для вращения · Колесо для зума · Клик на сотрудника
      </div>

      {/* Active agent panel */}
      {activeAgent && (
        <div style={{ position:'absolute', bottom:10, left:'50%', transform:'translateX(-50%)', background:'rgba(255,255,255,0.96)', border:`2px solid ${activeAgent.color}`, borderRadius:14, padding:'12px 20px', display:'flex', alignItems:'center', gap:14, minWidth:270, boxShadow:`0 4px 24px ${activeAgent.color}30` }}>
          <div style={{ width:42, height:42, borderRadius:'50%', background:`linear-gradient(135deg,${activeAgent.color},${activeAgent.color}88)`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20 }}>
            {activeAgent.id === 'manager' ? '👔' : activeAgent.id === 'devops' ? '⚙️' : activeAgent.id === 'designer' ? '🎨' : activeAgent.id === 'qa' ? '🔍' : activeAgent.id === 'analyst' ? '📊' : '💻'}
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:15, fontWeight:700, color:'#1a1a2e', marginBottom:2 }}>{activeAgent.name}</div>
            <div style={{ fontSize:11, color:activeAgent.color, fontWeight:600 }}>{activeAgent.role}</div>
          </div>
          <button onClick={() => setActiveAgentId(null)} style={{ background:'none', border:'none', color:'#999', cursor:'pointer', fontSize:18, lineHeight:1 }}>✕</button>
        </div>
      )}
    </div>
  )
}
