import { useRef, useMemo, useState, useEffect, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

interface AgentTask {
  id: string
  title: string
  description?: string
  type?: string
  status?: string
  priority?: string
}

interface AgentDef {
  id: string
  name: string
  role: string
  color: string
  pos: [number, number, number]
  deskPos: [number, number, number]
  activity: 'working' | 'meeting' | 'idle' | 'running'
  facing: number // rotation Y
}

const AGENTS: AgentDef[] = [
  { id: 'planner',  name: 'Планировщик', role: 'Task Planner',  color: '#6366f1', pos: [-5.5, 0, -3],   deskPos: [-5.5, 0, -3.8],  activity: 'working', facing: 0 },
  { id: 'coder',    name: 'Кодер',       role: 'Code Writer',   color: '#22d3ee', pos: [-2.5, 0, -3],   deskPos: [-2.5, 0, -3.8],  activity: 'working', facing: 0 },
  { id: 'reviewer', name: 'Ревьюер',     role: 'Code Reviewer', color: '#a855f7', pos: [0.5,  0, -3],   deskPos: [0.5,  0, -3.8],  activity: 'working', facing: 0 },
  { id: 'qa',       name: 'QA',          role: 'Quality Gate',  color: '#34d399', pos: [3.5,  0, -3],   deskPos: [3.5,  0, -3.8],  activity: 'idle',    facing: 0 },
  { id: 'devops',   name: 'DevOps',      role: 'CI/CD Agent',   color: '#f59e0b', pos: [-5.5, 0, 0.5],  deskPos: [-5.5, 0, 1.3],   activity: 'running', facing: Math.PI },
  { id: 'analyst',  name: 'Аналитик',    role: 'Data Analyst',  color: '#f87171', pos: [-1,   0, 3.8],  deskPos: [-1,   0, 3.8],   activity: 'meeting', facing: 0 },
  { id: 'designer', name: 'Дизайнер',    role: 'UI Designer',   color: '#e879f9', pos: [1,    0, 3.8],  deskPos: [1,    0, 3.8],   activity: 'meeting', facing: 0 },
  { id: 'manager',  name: 'Менеджер',    role: 'Orchestrator',  color: '#fbbf24', pos: [0,    0, 2.5],  deskPos: [0,    0, 2.5],   activity: 'meeting', facing: 0 },
]

// ─── Camera controls ──────────────────────────────────────────────────────────

function CameraRig() {
  const { camera, gl } = useThree()
  const s = useRef({
    isDragging: false, lastX: 0, lastY: 0,
    theta: -0.2, phi: 0.75, radius: 13,
    targetTheta: -0.2, targetPhi: 0.75, targetRadius: 13
  })

  useEffect(() => {
    const el = gl.domElement
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      s.current.isDragging = true
      s.current.lastX = e.clientX
      s.current.lastY = e.clientY
    }
    const onUp = () => { s.current.isDragging = false }
    const onMove = (e: MouseEvent) => {
      if (!s.current.isDragging) return
      const dx = (e.clientX - s.current.lastX) * 0.008
      const dy = (e.clientY - s.current.lastY) * 0.008
      s.current.targetTheta -= dx
      s.current.targetPhi = Math.max(0.25, Math.min(1.35, s.current.targetPhi + dy))
      s.current.lastX = e.clientX
      s.current.lastY = e.clientY
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      s.current.targetRadius = Math.max(5, Math.min(20, s.current.targetRadius + e.deltaY * 0.015))
    }
    const onTouch = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        s.current.isDragging = true
        s.current.lastX = e.touches[0].clientX
        s.current.lastY = e.touches[0].clientY
      }
    }
    el.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('mousemove', onMove)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouch, { passive: true })
    return () => {
      el.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('mousemove', onMove)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouch)
    }
  }, [gl])

  useFrame(() => {
    const d = s.current
    d.theta += (d.targetTheta - d.theta) * 0.1
    d.phi += (d.targetPhi - d.phi) * 0.1
    d.radius += (d.targetRadius - d.radius) * 0.1
    camera.position.set(
      d.radius * Math.sin(d.phi) * Math.sin(d.theta),
      d.radius * Math.cos(d.phi) + 0.5,
      d.radius * Math.sin(d.phi) * Math.cos(d.theta),
    )
    camera.lookAt(0, 1, 0)
  })
  return null
}

// ─── Office room ──────────────────────────────────────────────────────────────

function Room() {
  const wallColor = '#d4c9bc'
  const floorColor = '#8b7355'
  const ceilColor = '#e8e0d5'

  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[18, 14]} />
        <meshStandardMaterial color={floorColor} roughness={0.8} />
      </mesh>
      {/* Floor tiles pattern */}
      {Array.from({ length: 9 }, (_, xi) => Array.from({ length: 7 }, (_, zi) => (
        <mesh key={`t${xi}${zi}`} rotation={[-Math.PI / 2, 0, 0]} position={[xi * 2 - 8, 0.001, zi * 2 - 6]}>
          <planeGeometry args={[1.9, 1.9]} />
          <meshStandardMaterial color={(xi + zi) % 2 === 0 ? '#9c8660' : '#7a6445'} roughness={0.9} />
        </mesh>
      )))}
      {/* Ceiling */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 4, 0]}>
        <planeGeometry args={[18, 14]} />
        <meshStandardMaterial color={ceilColor} roughness={1} />
      </mesh>
      {/* Back wall */}
      <mesh position={[0, 2, -7]} receiveShadow>
        <planeGeometry args={[18, 4]} />
        <meshStandardMaterial color={wallColor} roughness={0.9} />
      </mesh>
      {/* Left wall */}
      <mesh position={[-9, 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[14, 4]} />
        <meshStandardMaterial color="#ccc3b5" roughness={0.9} />
      </mesh>
      {/* Right wall */}
      <mesh position={[9, 2, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[14, 4]} />
        <meshStandardMaterial color="#ccc3b5" roughness={0.9} />
      </mesh>
      {/* Windows on back wall */}
      {[-4, 4].map(x => (
        <group key={x} position={[x, 2.2, -6.95]}>
          <mesh>
            <planeGeometry args={[2.2, 1.6]} />
            <meshStandardMaterial color="#87ceeb" emissive="#87ceeb" emissiveIntensity={0.3} transparent opacity={0.7} />
          </mesh>
          {/* Window frame */}
          <mesh position={[0, 0, 0.01]}>
            <planeGeometry args={[2.3, 1.7]} />
            <meshStandardMaterial color="#8b7355" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0, 0.02]}>
            <planeGeometry args={[2.2, 1.6]} />
            <meshStandardMaterial color="#87ceeb" emissive="#87ceeb" emissiveIntensity={0.3} transparent opacity={0.7} />
          </mesh>
          <pointLight position={[0, 0, 0.5]} color="#fff8e1" intensity={1.5} distance={6} />
        </group>
      ))}
      {/* Baseboard */}
      <mesh position={[0, 0.05, -6.95]}>
        <boxGeometry args={[18, 0.12, 0.05]} />
        <meshStandardMaterial color="#6b5b45" roughness={0.5} />
      </mesh>
    </group>
  )
}

// ─── Office furniture ─────────────────────────────────────────────────────────

function Desk({ pos, color, rotation = 0 }: { pos: [number, number, number]; color: string; rotation?: number }) {
  return (
    <group position={pos} rotation={[0, rotation, 0]}>
      {/* Desktop */}
      <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.4, 0.04, 0.75]} />
        <meshStandardMaterial color="#c8b89a" roughness={0.4} metalness={0.1} />
      </mesh>
      {/* Legs */}
      {([-0.64, 0.64] as number[]).flatMap(x =>
        ([-0.32, 0.32] as number[]).map(z => (
          <mesh key={`${x}${z}`} position={[x, 0.37, z]} castShadow>
            <boxGeometry args={[0.05, 0.74, 0.05]} />
            <meshStandardMaterial color="#8b7355" roughness={0.5} />
          </mesh>
        ))
      )}
      {/* Monitor */}
      <mesh position={[0, 1.12, -0.28]} castShadow>
        <boxGeometry args={[0.62, 0.38, 0.03]} />
        <meshStandardMaterial color="#1a1a2e" roughness={0.3} metalness={0.8} />
      </mesh>
      {/* Screen glow */}
      <mesh position={[0, 1.12, -0.26]}>
        <planeGeometry args={[0.56, 0.32]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} transparent opacity={0.9} />
      </mesh>
      {/* Monitor stand */}
      <mesh position={[0, 0.87, -0.24]} castShadow>
        <boxGeometry args={[0.08, 0.26, 0.08]} />
        <meshStandardMaterial color="#2a2a3e" roughness={0.5} metalness={0.6} />
      </mesh>
      {/* Keyboard */}
      <mesh position={[0, 0.77, 0.1]}>
        <boxGeometry args={[0.5, 0.02, 0.18]} />
        <meshStandardMaterial color="#2a2a3e" roughness={0.6} />
      </mesh>
      <pointLight position={[0, 1, -0.1]} color={color} intensity={0.4} distance={2} />
    </group>
  )
}

function Chair({ pos, rotation = 0 }: { pos: [number, number, number]; rotation?: number }) {
  return (
    <group position={pos} rotation={[0, rotation, 0]}>
      {/* Seat */}
      <mesh position={[0, 0.44, 0]} castShadow>
        <boxGeometry args={[0.46, 0.06, 0.46]} />
        <meshStandardMaterial color="#3a3a5c" roughness={0.8} />
      </mesh>
      {/* Back */}
      <mesh position={[0, 0.82, -0.22]} castShadow>
        <boxGeometry args={[0.46, 0.62, 0.06]} />
        <meshStandardMaterial color="#3a3a5c" roughness={0.8} />
      </mesh>
      {/* Armrests */}
      {([-0.25, 0.25] as number[]).map(x => (
        <mesh key={x} position={[x, 0.6, 0]} castShadow>
          <boxGeometry args={[0.04, 0.04, 0.42]} />
          <meshStandardMaterial color="#2a2a4c" roughness={0.6} />
        </mesh>
      ))}
      {/* Pedestal */}
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 0.44, 8]} />
        <meshStandardMaterial color="#1a1a2e" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* Wheels base */}
      <mesh position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.22, 0.22, 0.04, 5]} />
        <meshStandardMaterial color="#1a1a2e" metalness={0.7} roughness={0.4} />
      </mesh>
    </group>
  )
}

function MeetingTable() {
  return (
    <group position={[0, 0, 3]}>
      {/* Table top */}
      <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.4, 1.4, 0.06, 32]} />
        <meshStandardMaterial color="#c8b89a" roughness={0.3} metalness={0.1} />
      </mesh>
      {/* Pedestal */}
      <mesh position={[0, 0.37, 0]}>
        <cylinderGeometry args={[0.06, 0.08, 0.74, 8]} />
        <meshStandardMaterial color="#8b7355" roughness={0.4} />
      </mesh>
      {/* Base plate */}
      <mesh position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.5, 0.5, 0.06, 16]} />
        <meshStandardMaterial color="#6b5b45" roughness={0.5} />
      </mesh>
      {/* Center lamp */}
      <mesh position={[0, 2.8, 0]}>
        <cylinderGeometry args={[0.18, 0.3, 0.12, 16]} />
        <meshStandardMaterial color="#e8d5a0" emissive="#fff8e1" emissiveIntensity={1} />
      </mesh>
      <pointLight position={[0, 2.6, 0]} color="#fff8e1" intensity={3} distance={4} castShadow />
    </group>
  )
}

function Bookshelf({ pos }: { pos: [number, number, number] }) {
  return (
    <group position={pos}>
      <mesh position={[0, 1.5, 0]} castShadow>
        <boxGeometry args={[1.2, 3, 0.3]} />
        <meshStandardMaterial color="#8b7355" roughness={0.6} />
      </mesh>
      {[0.6, 1.2, 1.8, 2.4].map((y, i) => (
        <mesh key={y} position={[0, y, 0.02]} castShadow>
          <boxGeometry args={[1.1, 0.04, 0.28]} />
          <meshStandardMaterial color="#6b5b45" roughness={0.7} />
        </mesh>
      ))}
      {/* Books */}
      {[0.6, 1.2, 1.8].map((y, si) =>
        Array.from({ length: 6 }, (_, bi) => (
          <mesh key={`${y}-${bi}`} position={[-0.42 + bi * 0.16, y + 0.18, 0]} castShadow>
            <boxGeometry args={[0.12, 0.32, 0.22]} />
            <meshStandardMaterial color={['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c'][bi]} roughness={0.8} />
          </mesh>
        ))
      )}
    </group>
  )
}

function PlantPot({ pos }: { pos: [number, number, number] }) {
  return (
    <group position={pos}>
      <mesh position={[0, 0.18, 0]} castShadow>
        <cylinderGeometry args={[0.14, 0.1, 0.28, 12]} />
        <meshStandardMaterial color="#c1440e" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.42, 0]} castShadow>
        <sphereGeometry args={[0.22, 10, 8]} />
        <meshStandardMaterial color="#2d8a4e" roughness={1} />
      </mesh>
      {/* Leaves */}
      {[0, 1, 2, 3].map(i => (
        <mesh key={i} position={[Math.sin(i * Math.PI / 2) * 0.18, 0.48, Math.cos(i * Math.PI / 2) * 0.18]} rotation={[0.3, i * Math.PI / 2, 0]} castShadow>
          <boxGeometry args={[0.04, 0.22, 0.08]} />
          <meshStandardMaterial color="#1d6b35" roughness={1} />
        </mesh>
      ))}
    </group>
  )
}

function CeilingLight({ pos }: { pos: [number, number, number] }) {
  return (
    <group position={pos}>
      <mesh>
        <boxGeometry args={[0.8, 0.04, 0.25]} />
        <meshStandardMaterial color="#e8e0d5" emissive="#fff8e1" emissiveIntensity={0.8} />
      </mesh>
      <pointLight color="#fff8e1" intensity={1.2} distance={6} castShadow />
    </group>
  )
}

// ─── Human figure ─────────────────────────────────────────────────────────────

function HumanFigure({ agent, isActive, onClick, taskStatus, chatMsg }: {
  agent: AgentDef
  isActive: boolean
  onClick: () => void
  taskStatus?: string
  chatMsg?: string
}) {
  const group = useRef<THREE.Group>(null!)
  const leftArm = useRef<THREE.Mesh>(null!)
  const rightArm = useRef<THREE.Mesh>(null!)
  const leftLeg = useRef<THREE.Mesh>(null!)
  const rightLeg = useRef<THREE.Mesh>(null!)
  const head = useRef<THREE.Mesh>(null!)
  const hovered = useRef(false)
  const t = useRef(Math.random() * Math.PI * 2)

  const activity = taskStatus === 'running' ? 'running' : agent.activity

  useFrame((_, dt) => {
    t.current += dt
    if (!group.current) return

    const tc = t.current
    const speed = activity === 'running' ? 8 : activity === 'working' ? 3 : 1.5

    // Arm swing
    if (leftArm.current) leftArm.current.rotation.x = Math.sin(tc * speed) * (activity === 'running' ? 0.6 : activity === 'working' ? 0.25 : 0.12)
    if (rightArm.current) rightArm.current.rotation.x = -Math.sin(tc * speed) * (activity === 'running' ? 0.6 : activity === 'working' ? 0.25 : 0.12)

    // Leg movement (only for running/walking)
    if (activity === 'running') {
      if (leftLeg.current) leftLeg.current.rotation.x = Math.sin(tc * speed) * 0.4
      if (rightLeg.current) rightLeg.current.rotation.x = -Math.sin(tc * speed) * 0.4
      group.current.position.y = Math.abs(Math.sin(tc * speed)) * 0.04
    } else {
      if (leftLeg.current) leftLeg.current.rotation.x = 0
      if (rightLeg.current) rightLeg.current.rotation.x = 0
      group.current.position.y = 0
    }

    // Head movement
    if (head.current) {
      if (activity === 'working') {
        head.current.rotation.x = -0.25 + Math.sin(tc * 0.5) * 0.05  // looking at screen
      } else if (activity === 'meeting') {
        head.current.rotation.y = Math.sin(tc * 0.6) * 0.3  // looking around
        head.current.rotation.x = Math.sin(tc * 0.4) * 0.08
      } else {
        head.current.rotation.x = 0
        head.current.rotation.y = Math.sin(tc * 0.3) * 0.1
      }
    }

    // Idle breathing
    if (activity === 'idle') {
      group.current.position.y = Math.sin(tc * 0.8) * 0.008
    }

    // Scale on hover/active
    const target = hovered.current || isActive ? 1.08 : 1
    const ns = group.current.scale.x + (target - group.current.scale.x) * 0.12
    group.current.scale.setScalar(ns)
  })

  const skinColor = '#f5c5a3'
  const shirtColor = agent.color

  return (
    <group
      ref={group}
      position={agent.pos}
      rotation={[0, agent.facing, 0]}
      onClick={e => { e.stopPropagation(); onClick() }}
      onPointerOver={() => { hovered.current = true; document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { hovered.current = false; document.body.style.cursor = 'auto' }}
    >
      {/* Shadow under feet */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <circleGeometry args={[0.22, 16]} />
        <meshStandardMaterial color="#000" transparent opacity={0.15} />
      </mesh>

      {/* Left leg */}
      <mesh ref={leftLeg} position={[-0.09, 0.28, 0]} castShadow>
        <boxGeometry args={[0.1, 0.56, 0.1]} />
        <meshStandardMaterial color="#2c3e50" roughness={0.8} />
      </mesh>
      {/* Right leg */}
      <mesh ref={rightLeg} position={[0.09, 0.28, 0]} castShadow>
        <boxGeometry args={[0.1, 0.56, 0.1]} />
        <meshStandardMaterial color="#2c3e50" roughness={0.8} />
      </mesh>
      {/* Shoes */}
      {([-0.09, 0.09] as number[]).map(x => (
        <mesh key={x} position={[x, 0.04, 0.04]} castShadow>
          <boxGeometry args={[0.12, 0.08, 0.2]} />
          <meshStandardMaterial color="#1a1a2e" roughness={0.5} />
        </mesh>
      ))}

      {/* Torso / shirt */}
      <mesh position={[0, 0.82, 0]} castShadow>
        <boxGeometry args={[0.3, 0.4, 0.17]} />
        <meshStandardMaterial color={shirtColor} roughness={0.6} />
      </mesh>
      {/* Collar */}
      <mesh position={[0, 0.99, 0.06]}>
        <boxGeometry args={[0.14, 0.06, 0.04]} />
        <meshStandardMaterial color="#fff" roughness={0.5} />
      </mesh>

      {/* Left arm */}
      <mesh ref={leftArm} position={[-0.2, 0.82, 0]} castShadow>
        <boxGeometry args={[0.09, 0.38, 0.09]} />
        <meshStandardMaterial color={shirtColor} roughness={0.6} />
      </mesh>
      {/* Right arm */}
      <mesh ref={rightArm} position={[0.2, 0.82, 0]} castShadow>
        <boxGeometry args={[0.09, 0.38, 0.09]} />
        <meshStandardMaterial color={shirtColor} roughness={0.6} />
      </mesh>
      {/* Hands */}
      {([-0.2, 0.2] as number[]).map(x => (
        <mesh key={x} position={[x, 0.62, 0]}>
          <boxGeometry args={[0.09, 0.1, 0.09]} />
          <meshStandardMaterial color={skinColor} roughness={0.8} />
        </mesh>
      ))}

      {/* Neck */}
      <mesh position={[0, 1.05, 0]} castShadow>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshStandardMaterial color={skinColor} roughness={0.8} />
      </mesh>

      {/* Head */}
      <mesh ref={head} position={[0, 1.23, 0]} castShadow>
        <boxGeometry args={[0.24, 0.26, 0.22]} />
        <meshStandardMaterial color={skinColor} roughness={0.8} />
      </mesh>
      {/* Eyes */}
      {([-0.07, 0.07] as number[]).map(x => (
        <mesh key={x} position={[x, 1.25, 0.113]}>
          <sphereGeometry args={[0.028, 8, 8]} />
          <meshStandardMaterial color="#1a1a2e" roughness={0.3} />
        </mesh>
      ))}
      {/* Pupils */}
      {([-0.07, 0.07] as number[]).map(x => (
        <mesh key={x} position={[x, 1.25, 0.138]}>
          <sphereGeometry args={[0.014, 6, 6]} />
          <meshStandardMaterial color={agent.color} emissive={agent.color} emissiveIntensity={0.8} />
        </mesh>
      ))}
      {/* Hair */}
      <mesh position={[0, 1.36, 0]}>
        <boxGeometry args={[0.25, 0.08, 0.23]} />
        <meshStandardMaterial color="#2c1810" roughness={1} />
      </mesh>

      {/* Name badge (floating) */}
      <mesh position={[0, 1.62, 0]}>
        <planeGeometry args={[0.36, 0.1]} />
        <meshStandardMaterial color={agent.color} emissive={agent.color} emissiveIntensity={isActive ? 1.5 : 0.5} transparent opacity={0.9} />
      </mesh>

      {/* Running pulse ring */}
      {activity === 'running' && <PulseRing color={agent.color} />}
      {isActive && <pointLight color={agent.color} intensity={1.5} distance={2} position={[0, 0.8, 0]} />}
    </group>
  )
}

function PulseRing({ color }: { color: string }) {
  const m = useRef<THREE.Mesh>(null!)
  const t = useRef(0)
  useFrame((_, dt) => {
    t.current += dt * 2
    if (!m.current) return
    const s = 1 + Math.sin(t.current) * 0.4
    m.current.scale.setScalar(s)
    ;(m.current.material as THREE.MeshStandardMaterial).opacity = 0.6 - Math.sin(t.current) * 0.25
  })
  return (
    <mesh ref={m} position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.2, 0.28, 20]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2} transparent opacity={0.6} />
    </mesh>
  )
}

// ─── Floating chat bubble ─────────────────────────────────────────────────────

function ChatBubble({ text, color, position }: { text: string; color: string; position: [number, number, number] }) {
  const m = useRef<THREE.Mesh>(null!)
  const t = useRef(0)
  useFrame((_, dt) => {
    t.current += dt
    if (m.current) m.current.position.y = position[1] + Math.sin(t.current * 0.8) * 0.04
  })
  return (
    <mesh ref={m} position={position}>
      <planeGeometry args={[0.5, 0.15]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} transparent opacity={0.85} />
    </mesh>
  )
}

// ─── Task status board ────────────────────────────────────────────────────────

function TaskBoard({ status, title }: { status?: string; title: string }) {
  const col = status === 'running' ? '#22d3ee' : status === 'completed' ? '#34d399' : status === 'failed' ? '#e74c3c' : '#6366f1'
  const t = useRef(0)
  const light = useRef<THREE.PointLight>(null!)
  useFrame((_, dt) => {
    t.current += dt
    if (light.current) light.current.intensity = 0.8 + Math.sin(t.current * 2) * 0.2
  })
  return (
    <group position={[-8.7, 2.4, -4]}>
      {/* Board frame */}
      <mesh castShadow>
        <boxGeometry args={[0.08, 2.2, 3.2]} />
        <meshStandardMaterial color="#5a4a3a" roughness={0.6} />
      </mesh>
      {/* Board surface */}
      <mesh position={[0.07, 0, 0]}>
        <planeGeometry args={[3.0, 2.0]} />
        <meshStandardMaterial color="#1a1a2e" roughness={0.3} />
      </mesh>
      {/* Status bar */}
      <mesh position={[0.09, 0.6, 0]}>
        <planeGeometry args={[2.5, 0.22]} />
        <meshStandardMaterial color={col} emissive={col} emissiveIntensity={0.7} />
      </mesh>
      {/* Lines for text */}
      {[-0.05, -0.35, -0.65].map((y, i) => (
        <mesh key={y} position={[0.09, y, (i - 1) * 0.3]}>
          <planeGeometry args={[i === 0 ? 2.2 : 1.6, 0.06]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.4 - i * 0.1} />
        </mesh>
      ))}
      <pointLight ref={light} position={[0.5, 0, 0]} color={col} intensity={0.8} distance={3} />
    </group>
  )
}

// ─── Scene ────────────────────────────────────────────────────────────────────

function Scene({ task, activeAgentId, onAgentClick, taskLogs }: {
  task: AgentTask
  activeAgentId: string | null
  onAgentClick: (id: string) => void
  taskLogs: string[]
}) {
  const activeAgents = useMemo(() => {
    const tt = (task.type || '').toLowerCase()
    if (tt.includes('api') || tt.includes('backend') || tt.includes('integration')) return ['planner', 'coder', 'reviewer', 'devops']
    if (tt.includes('front') || tt.includes('ui') || tt.includes('design')) return ['planner', 'designer', 'coder', 'qa']
    return ['planner', 'coder', 'reviewer']
  }, [task.type])

  // Map log messages to agents
  const agentMessages = useMemo(() => {
    const map: Record<string, string> = {}
    const keywordMap: Record<string, string> = {
      'план': 'planner', 'task': 'planner', 'created': 'planner',
      'код': 'coder', 'patch': 'coder', 'code': 'coder', 'pipeline': 'coder',
      'review': 'reviewer', 'ревью': 'reviewer',
      'qa': 'qa', 'test': 'qa', 'quality': 'qa',
      'git': 'devops', 'branch': 'devops', 'push': 'devops', 'commit': 'devops',
      'analyt': 'analyst', 'context': 'analyst', 'knowledge': 'analyst',
      'design': 'designer', 'ui': 'designer',
      'manager': 'manager', 'orchestr': 'manager', 'spawn': 'manager',
    }
    const recentLogs = taskLogs.slice(-12)
    recentLogs.forEach(msg => {
      const lower = msg.toLowerCase()
      for (const [kw, agentId] of Object.entries(keywordMap)) {
        if (lower.includes(kw) && !map[agentId]) {
          map[agentId] = msg.replace(/^\[\d+:\d+:\d+\]\s*/, '').slice(0, 40)
          break
        }
      }
    })
    return map
  }, [taskLogs])

  return (
    <>
      <CameraRig />

      {/* Lighting */}
      <ambientLight intensity={0.5} color="#fff8f0" />
      <directionalLight position={[5, 8, 3]} intensity={0.6} color="#fff8e1" castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={0.5} shadow-camera-far={30}
        shadow-camera-left={-12} shadow-camera-right={12}
        shadow-camera-top={10} shadow-camera-bottom={-8}
      />
      {/* Ceiling lights */}
      <CeilingLight pos={[-4, 3.92, -2]} />
      <CeilingLight pos={[0, 3.92, -2]} />
      <CeilingLight pos={[4, 3.92, -2]} />
      <CeilingLight pos={[-3, 3.92, 1.5]} />
      <CeilingLight pos={[3, 3.92, 1.5]} />

      {/* Room */}
      <Room />

      {/* Task board on left wall */}
      <TaskBoard status={task.status} title={task.title} />

      {/* Bookshelves */}
      <Bookshelf pos={[8.5, 0, -4]} />
      <Bookshelf pos={[8.5, 0, -1]} />

      {/* Plants */}
      <PlantPot pos={[-8.5, 0, 5.5]} />
      <PlantPot pos={[8.5, 0, 5.5]} />

      {/* Work desks — row 1 (back) */}
      {AGENTS.slice(0, 4).map(a => (
        <group key={a.id}>
          <Desk pos={a.deskPos} color={a.color} />
          <Chair pos={[a.deskPos[0], 0, a.deskPos[2] + 0.7]} />
        </group>
      ))}

      {/* Work desk — row 2 (DevOps alone) */}
      <Desk pos={AGENTS[4].deskPos} color={AGENTS[4].color} rotation={Math.PI} />
      <Chair pos={[AGENTS[4].deskPos[0], 0, AGENTS[4].deskPos[2] - 0.7]} rotation={Math.PI} />

      {/* Meeting area */}
      <MeetingTable />

      {/* Agents */}
      {AGENTS.map(a => (
        <HumanFigure
          key={a.id}
          agent={a}
          isActive={a.id === activeAgentId}
          onClick={() => onAgentClick(a.id)}
          taskStatus={activeAgents.includes(a.id) ? task.status : undefined}
          chatMsg={agentMessages[a.id]}
        />
      ))}

      {/* Chat bubbles for agents with messages */}
      {Object.entries(agentMessages).map(([agentId, msg]) => {
        const agent = AGENTS.find(a => a.id === agentId)
        if (!agent) return null
        return (
          <ChatBubble
            key={agentId}
            text={msg}
            color={agent.color}
            position={[agent.pos[0], agent.pos[1] + 1.9, agent.pos[2]]}
          />
        )
      })}
    </>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AgentOffice3D({ task }: { task: AgentTask }) {
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const [taskLogs, setTaskLogs] = useState<string[]>([])
  const activeAgent = AGENTS.find(a => a.id === activeAgentId)

  // Poll task logs
  useEffect(() => {
    let cancelled = false
    const fetchLogs = async () => {
      try {
        const token = localStorage.getItem('authToken') || sessionStorage.getItem('authToken') || ''
        const res = await fetch(`/api/v1/agent-tasks/${task.id}/logs`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data.logs) {
          setTaskLogs((data.logs as any[]).map((l: any) => typeof l === 'string' ? l : (l.msg || l.message || JSON.stringify(l))))
        }
      } catch { /* silent */ }
    }
    fetchLogs()
    const iv = setInterval(fetchLogs, 3000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [task.id])

  const handleAgentClick = useCallback((id: string) => {
    setActiveAgentId(prev => prev === id ? null : id)
  }, [])

  const statusColor = task.status === 'running' ? '#22d3ee' : task.status === 'completed' ? '#34d399' : task.status === 'failed' ? '#e74c3c' : '#6366f1'
  const statusLabel = task.status === 'running' ? 'ВЫПОЛНЯЕТСЯ' : task.status === 'completed' ? 'ГОТОВО' : task.status === 'failed' ? 'ОШИБКА' : 'ОЖИДАНИЕ'

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#c8d4dc', fontFamily: 'system-ui, sans-serif' }}>
      <Canvas
        shadows
        camera={{ position: [0, 7, 13], fov: 50 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.2 }}
      >
        <Scene task={task} activeAgentId={activeAgentId} onAgentClick={handleAgentClick} taskLogs={taskLogs} />
      </Canvas>

      {/* Task info */}
      <div style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', border: `2px solid ${statusColor}`, borderRadius: 10, padding: '8px 14px', maxWidth: 240, boxShadow: '0 2px 12px rgba(0,0,0,0.15)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: statusColor, display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor, display: 'inline-block', boxShadow: `0 0 6px ${statusColor}` }} />
          {statusLabel}
        </div>
      </div>

      {/* Agent legend */}
      <div style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(8px)', borderRadius: 10, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4, boxShadow: '0 2px 12px rgba(0,0,0,0.12)' }}>
        {AGENTS.map(a => (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#1a1a2e', cursor: 'pointer' }}
            onClick={() => handleAgentClick(a.id)}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: a.color, flexShrink: 0 }} />
            <span style={{ fontWeight: activeAgentId === a.id ? 700 : 400 }}>{a.name}</span>
          </div>
        ))}
      </div>

      {/* Live log feed */}
      {taskLogs.length > 0 && (
        <div style={{ position: 'absolute', bottom: activeAgent ? 100 : 10, left: 12, right: 12, background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(8px)', borderRadius: 10, padding: '8px 12px', maxHeight: 80, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.12)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6366f1', marginBottom: 4 }}>ЛОГИ ЗАДАЧИ</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {taskLogs.slice(-3).map((log, i) => (
              <div key={i} style={{ fontSize: 10, color: '#444', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log}</div>
            ))}
          </div>
        </div>
      )}

      {/* Hint */}
      <div style={{ position: 'absolute', bottom: activeAgent ? 98 : 8, left: '50%', transform: 'translateX(-50%)', fontSize: 10, color: 'rgba(0,0,0,0.35)', pointerEvents: 'none', whiteSpace: 'nowrap', background: 'rgba(255,255,255,0.6)', padding: '2px 8px', borderRadius: 6 }}>
        Тяни для вращения · Колесо для зума · Клик на сотрудника
      </div>

      {/* Active agent panel */}
      {activeAgent && (
        <div style={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)', border: `2px solid ${activeAgent.color}`, borderRadius: 14, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 14, minWidth: 280, boxShadow: `0 4px 24px ${activeAgent.color}30` }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: `linear-gradient(135deg, ${activeAgent.color}, ${activeAgent.color}88)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 22 }}>
            {activeAgent.activity === 'working' ? '💻' : activeAgent.activity === 'running' ? '⚡' : activeAgent.activity === 'meeting' ? '💬' : '😴'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e', marginBottom: 2 }}>{activeAgent.name}</div>
            <div style={{ fontSize: 11, color: activeAgent.color, fontWeight: 600 }}>{activeAgent.role}</div>
            <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
              {activeAgent.activity === 'running' ? '⚡ Активно выполняет задачу' : activeAgent.activity === 'working' ? '💻 Пишет код' : activeAgent.activity === 'meeting' ? '💬 На совещании у круглого стола' : '⏸ Ожидает задач'}
            </div>
          </div>
          <button onClick={() => setActiveAgentId(null)} style={{ background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: 18, padding: 4, lineHeight: 1 }}>✕</button>
        </div>
      )}
    </div>
  )
}
