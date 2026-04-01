import { useRef, useMemo, useState, useEffect } from 'react'
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
  activity: 'working' | 'meeting' | 'idle' | 'running'
}

const AGENTS: AgentDef[] = [
  { id: 'planner',  name: 'Планировщик', role: 'Task Planner',   color: '#6366f1', pos: [-4,   0, -2],  activity: 'working'  },
  { id: 'coder',    name: 'Кодер',       role: 'Code Writer',    color: '#22d3ee', pos: [-1.5, 0, -2],  activity: 'working'  },
  { id: 'reviewer', name: 'Ревьюер',     role: 'Code Reviewer',  color: '#a855f7', pos: [1,    0, -2],  activity: 'working'  },
  { id: 'qa',       name: 'QA',          role: 'Quality Gate',   color: '#34d399', pos: [3.5,  0, -2],  activity: 'idle'     },
  { id: 'devops',   name: 'DevOps',      role: 'CI/CD Agent',    color: '#f59e0b', pos: [-4,   0, 1.5], activity: 'running'  },
  { id: 'analyst',  name: 'Аналитик',    role: 'Data Analyst',   color: '#f87171', pos: [-1.5, 0, 1.5], activity: 'meeting'  },
  { id: 'designer', name: 'Дизайнер',    role: 'UI Designer',    color: '#e879f9', pos: [1,    0, 1.5], activity: 'meeting'  },
  { id: 'manager',  name: 'Менеджер',    role: 'Orchestrator',   color: '#fbbf24', pos: [3.5,  0, 1.5], activity: 'meeting'  },
]

// ─── OrbitControls вручную ─────────────────────────────────────────────────────

function OrbitControlsManual() {
  const { camera, gl } = useThree()
  const state = useRef({ dragging: false, lastX: 0, lastY: 0, theta: 0.3, phi: 0.9, radius: 10 })

  useEffect(() => {
    const el = gl.domElement
    const onDown = (e: MouseEvent) => { state.current.dragging = true; state.current.lastX = e.clientX; state.current.lastY = e.clientY }
    const onUp = () => { state.current.dragging = false }
    const onMove = (e: MouseEvent) => {
      if (!state.current.dragging) return
      const dx = (e.clientX - state.current.lastX) * 0.01
      const dy = (e.clientY - state.current.lastY) * 0.01
      state.current.theta -= dx
      state.current.phi = Math.max(0.2, Math.min(1.4, state.current.phi + dy))
      state.current.lastX = e.clientX; state.current.lastY = e.clientY
    }
    const onWheel = (e: WheelEvent) => {
      state.current.radius = Math.max(4, Math.min(16, state.current.radius + e.deltaY * 0.01))
    }
    el.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('mousemove', onMove)
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => { el.removeEventListener('mousedown', onDown); window.removeEventListener('mouseup', onUp); window.removeEventListener('mousemove', onMove); el.removeEventListener('wheel', onWheel) }
  }, [gl])

  useFrame(() => {
    const { theta, phi, radius } = state.current
    camera.position.set(
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi) + 1,
      radius * Math.sin(phi) * Math.cos(theta),
    )
    camera.lookAt(0, 0.5, 0)
  })
  return null
}

// ─── Пол ──────────────────────────────────────────────────────────────────────

function Floor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[20, 14]} />
      <meshStandardMaterial color="#080818" roughness={0.9} metalness={0.2} />
    </mesh>
  )
}

// ─── Стены ────────────────────────────────────────────────────────────────────

function Walls() {
  return (
    <group>
      <mesh position={[0, 2, -5]} receiveShadow>
        <planeGeometry args={[20, 6]} />
        <meshStandardMaterial color="#0d0d20" roughness={0.9} />
      </mesh>
      <mesh position={[-7.5, 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[12, 6]} />
        <meshStandardMaterial color="#0b0b1c" roughness={0.9} />
      </mesh>
      <mesh position={[7.5, 2, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[12, 6]} />
        <meshStandardMaterial color="#0b0b1c" roughness={0.9} />
      </mesh>
    </group>
  )
}

// ─── Стол ─────────────────────────────────────────────────────────────────────

function Desk({ pos, color }: { pos: [number, number, number]; color: string }) {
  return (
    <group position={pos}>
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.2, 0.05, 0.65]} />
        <meshStandardMaterial color="#181830" roughness={0.5} metalness={0.3} />
      </mesh>
      {([-0.55, 0.55] as number[]).flatMap(x =>
        ([-0.28, 0.28] as number[]).map((z, j) => (
          <mesh key={`${x}${z}`} position={[x, 0.2, z]} castShadow>
            <boxGeometry args={[0.05, 0.4, 0.05]} />
            <meshStandardMaterial color="#111122" />
          </mesh>
        ))
      )}
      {/* Монитор */}
      <mesh position={[0, 0.72, -0.22]} castShadow>
        <boxGeometry args={[0.5, 0.3, 0.02]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} roughness={0.2} />
      </mesh>
      <pointLight position={[0, 0.6, -0.1]} color={color} intensity={0.5} distance={1.5} />
    </group>
  )
}

// ─── Стул ─────────────────────────────────────────────────────────────────────

function Chair({ pos }: { pos: [number, number, number] }) {
  return (
    <group position={pos}>
      <mesh position={[0, 0.26, 0]} castShadow>
        <boxGeometry args={[0.44, 0.05, 0.44]} />
        <meshStandardMaterial color="#1a1a30" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.62, -0.2]} castShadow>
        <boxGeometry args={[0.44, 0.7, 0.05]} />
        <meshStandardMaterial color="#1a1a30" roughness={0.9} />
      </mesh>
    </group>
  )
}

// ─── Круглый стол для совещаний ────────────────────────────────────────────────

function MeetingTable() {
  return (
    <group position={[0, 0, 3.5]}>
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.1, 1.1, 0.06, 32]} />
        <meshStandardMaterial color="#12122a" roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.4, 8]} />
        <meshStandardMaterial color="#111122" />
      </mesh>
      {/* Голограмма */}
      <mesh position={[0, 0.44, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.55, 32]} />
        <meshStandardMaterial color="#6366f1" emissive="#6366f1" emissiveIntensity={0.4} transparent opacity={0.35} />
      </mesh>
      <pointLight position={[0, 1, 0]} color="#6366f1" intensity={1.5} distance={3} />
    </group>
  )
}

// ─── Неоновые полосы ──────────────────────────────────────────────────────────

function NeonStrips() {
  return (
    <group>
      {([-3, 0, 3] as number[]).map((x) => (
        <group key={x} position={[x, 3.8, 0]}>
          <mesh>
            <boxGeometry args={[0.05, 0.03, 10]} />
            <meshStandardMaterial color="#6366f1" emissive="#6366f1" emissiveIntensity={3} />
          </mesh>
          <pointLight color="#6366f1" intensity={0.6} distance={5} />
        </group>
      ))}
    </group>
  )
}

// ─── Частицы данных ───────────────────────────────────────────────────────────

function Particles() {
  const mesh = useRef<THREE.InstancedMesh>(null!)
  const count = 50
  const data = useMemo(() => Array.from({ length: count }, () => ({
    x: (Math.random() - 0.5) * 14, y: Math.random() * 3 + 0.3, z: (Math.random() - 0.5) * 8,
    s: Math.random() * 0.3 + 0.1, o: Math.random() * Math.PI * 2,
  })), [])
  const dummy = useMemo(() => new THREE.Object3D(), [])

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    data.forEach((d, i) => {
      dummy.position.set(d.x + Math.sin(t * d.s + d.o) * 0.4, d.y + Math.sin(t * d.s * 1.3 + d.o) * 0.25, d.z + Math.cos(t * d.s + d.o) * 0.3)
      dummy.scale.setScalar(0.018 + Math.sin(t + d.o) * 0.006)
      dummy.updateMatrix()
      mesh.current?.setMatrixAt(i, dummy.matrix)
    })
    if (mesh.current) mesh.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
      <octahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#6366f1" emissive="#6366f1" emissiveIntensity={2.5} transparent opacity={0.65} />
    </instancedMesh>
  )
}

// ─── Агент ────────────────────────────────────────────────────────────────────

function AgentFigure({ agent, isActive, onClick, taskStatus }: {
  agent: AgentDef; isActive: boolean; onClick: () => void; taskStatus?: string
}) {
  const group = useRef<THREE.Group>(null!)
  const head = useRef<THREE.Mesh>(null!)
  const t = useRef(Math.random() * Math.PI * 2)
  const hovered = useRef(false)

  const activity = taskStatus === 'running' ? 'running' : agent.activity

  useFrame((_, dt) => {
    t.current += dt
    if (!group.current) return
    if (activity === 'working') {
      group.current.rotation.x = Math.sin(t.current * 2.5) * 0.05
      if (head.current) head.current.rotation.x = -Math.sin(t.current * 2.5) * 0.04
    } else if (activity === 'running') {
      group.current.position.x = agent.pos[0] + Math.sin(t.current * 4) * 0.04
      group.current.rotation.z = Math.sin(t.current * 4) * 0.05
    } else if (activity === 'meeting') {
      if (head.current) head.current.rotation.x = Math.sin(t.current * 1.2) * 0.1
      group.current.rotation.y = Math.sin(t.current * 0.4) * 0.12
    } else {
      group.current.position.y = Math.sin(t.current * 0.7) * 0.008
    }
    const target = hovered.current || isActive ? 1.15 : 1
    const s = group.current.scale.x
    const ns = s + (target - s) * 0.1
    group.current.scale.setScalar(ns)
  })

  return (
    <group
      ref={group}
      position={agent.pos}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      onPointerOver={() => { hovered.current = true; document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { hovered.current = false; document.body.style.cursor = 'auto' }}
    >
      {/* Аура */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.25, 20]} />
        <meshStandardMaterial color={agent.color} emissive={agent.color} emissiveIntensity={isActive ? 1.2 : 0.4} transparent opacity={0.3} />
      </mesh>
      {/* Ноги */}
      {([-0.07, 0.07] as number[]).map(x => (
        <mesh key={x} position={[x, 0.2, 0]} castShadow>
          <boxGeometry args={[0.08, 0.4, 0.08]} />
          <meshStandardMaterial color={agent.color} emissive={agent.color} emissiveIntensity={0.15} roughness={0.4} metalness={0.4} />
        </mesh>
      ))}
      {/* Торс */}
      <mesh position={[0, 0.62, 0]} castShadow>
        <boxGeometry args={[0.26, 0.36, 0.14]} />
        <meshStandardMaterial color={agent.color} emissive={agent.color} emissiveIntensity={0.2} roughness={0.3} metalness={0.6} />
      </mesh>
      {/* Руки */}
      {([-0.19, 0.19] as number[]).map(x => (
        <mesh key={x} position={[x, 0.62, 0]} castShadow>
          <boxGeometry args={[0.08, 0.32, 0.08]} />
          <meshStandardMaterial color={agent.color} emissive={agent.color} emissiveIntensity={0.1} roughness={0.4} />
        </mesh>
      ))}
      {/* Голова */}
      <mesh ref={head} position={[0, 0.93, 0]} castShadow>
        <boxGeometry args={[0.22, 0.22, 0.18]} />
        <meshStandardMaterial color={agent.color} emissive={agent.color} emissiveIntensity={0.4} roughness={0.2} metalness={0.7} />
      </mesh>
      {/* Глаза */}
      {([-0.06, 0.06] as number[]).map(x => (
        <mesh key={x} position={[x, 0.95, 0.093]}>
          <sphereGeometry args={[0.024, 8, 8]} />
          <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={2.5} />
        </mesh>
      ))}
      {/* Маркер имени */}
      <mesh position={[0, 1.22, 0]}>
        <boxGeometry args={[0.26, 0.035, 0.01]} />
        <meshStandardMaterial color={agent.color} emissive={agent.color} emissiveIntensity={isActive ? 2 : 0.6} />
      </mesh>
      {/* Пульс если running */}
      {activity === 'running' && <RunningPulse color={agent.color} />}
      {isActive && <pointLight color={agent.color} intensity={2} distance={1.5} position={[0, 0.5, 0]} />}
    </group>
  )
}

function RunningPulse({ color }: { color: string }) {
  const m = useRef<THREE.Mesh>(null!)
  const t = useRef(0)
  useFrame((_, dt) => {
    t.current += dt * 2.5
    if (m.current) {
      const s = 1 + Math.sin(t.current) * 0.5
      m.current.scale.setScalar(s)
      ;(m.current.material as THREE.MeshStandardMaterial).opacity = 0.7 - Math.sin(t.current) * 0.3
    }
  })
  return (
    <mesh ref={m} position={[0.16, 0.96, 0]}>
      <sphereGeometry args={[0.04, 8, 8]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={3} transparent opacity={0.7} />
    </mesh>
  )
}

// ─── Доска задачи ─────────────────────────────────────────────────────────────

function TaskBoard({ status }: { status?: string }) {
  const col = status === 'running' ? '#22d3ee' : status === 'completed' ? '#34d399' : status === 'failed' ? '#f87171' : '#6366f1'
  return (
    <group position={[-5.5, 2.5, -4.8]}>
      <mesh castShadow>
        <boxGeometry args={[3.5, 2, 0.06]} />
        <meshStandardMaterial color="#0d0d1e" roughness={0.3} metalness={0.7} />
      </mesh>
      <mesh position={[0, 0, 0.04]}>
        <planeGeometry args={[3.2, 1.75]} />
        <meshStandardMaterial color="#060616" emissive="#06061a" emissiveIntensity={0.8} />
      </mesh>
      {/* Полосы вместо текста */}
      <mesh position={[0, 0.55, 0.07]}>
        <boxGeometry args={[2.4, 0.14, 0.01]} />
        <meshStandardMaterial color={col} emissive={col} emissiveIntensity={0.9} />
      </mesh>
      <mesh position={[-0.2, 0.25, 0.07]}>
        <boxGeometry args={[2.0, 0.07, 0.01]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.2} transparent opacity={0.5} />
      </mesh>
      <mesh position={[-0.4, 0.05, 0.07]}>
        <boxGeometry args={[1.6, 0.07, 0.01]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.15} transparent opacity={0.35} />
      </mesh>
      <mesh position={[0, -0.2, 0.07]}>
        <boxGeometry args={[0.9, 0.1, 0.01]} />
        <meshStandardMaterial color={col} emissive={col} emissiveIntensity={1.2} />
      </mesh>
      <pointLight position={[0, 0, 0.6]} color={col} intensity={0.9} distance={3} />
    </group>
  )
}

// ─── Зона отдыха ─────────────────────────────────────────────────────────────

function BreakZone() {
  return (
    <group position={[5.5, 0, 3]}>
      <mesh position={[0, 0.24, 0]} castShadow>
        <boxGeometry args={[1.8, 0.24, 0.7]} />
        <meshStandardMaterial color="#1a1a35" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.44, -0.32]} castShadow>
        <boxGeometry args={[1.8, 0.38, 0.07]} />
        <meshStandardMaterial color="#1a1a35" roughness={0.9} />
      </mesh>
      <mesh position={[1.2, 0.4, 0.9]} castShadow>
        <cylinderGeometry args={[0.1, 0.13, 0.3, 8]} />
        <meshStandardMaterial color="#0d1a0d" />
      </mesh>
      <mesh position={[1.2, 0.72, 0.9]}>
        <sphereGeometry args={[0.2, 10, 8]} />
        <meshStandardMaterial color="#1a4d1a" roughness={1} />
      </mesh>
      <pointLight position={[0, 1.2, 0]} color="#a855f7" intensity={0.5} distance={2.5} />
    </group>
  )
}

// ─── Главная сцена ────────────────────────────────────────────────────────────

function Scene({ task, activeAgentId, onAgentClick }: {
  task: AgentTask; activeAgentId: string | null; onAgentClick: (id: string) => void
}) {
  const activeAgents = useMemo(() => {
    const t = (task.type || '').toLowerCase()
    if (t.includes('api') || t.includes('backend')) return ['planner', 'coder', 'reviewer', 'devops']
    if (t.includes('front') || t.includes('ui')) return ['planner', 'designer', 'coder', 'qa']
    return ['planner', 'coder', 'reviewer']
  }, [task.type])

  return (
    <>
      <OrbitControlsManual />
      <ambientLight intensity={0.1} />
      <directionalLight position={[5, 8, 3]} intensity={0.5} color="#9090ff" castShadow />
      <pointLight position={[0, 3.5, 0]} color="#6366f1" intensity={0.7} distance={12} />
      <NeonStrips />
      <Floor />
      <Walls />
      <TaskBoard status={task.status} />
      <MeetingTable />
      <BreakZone />
      {AGENTS.slice(0, 4).map(a => (
        <group key={a.id}>
          <Desk pos={[a.pos[0], 0, a.pos[2] + 0.12]} color={a.color} />
          <Chair pos={[a.pos[0], 0, a.pos[2] + 0.6]} />
        </group>
      ))}
      {AGENTS.slice(4).map(a => (
        <group key={a.id}>
          <Desk pos={[a.pos[0], 0, a.pos[2] - 0.12]} color={a.color} />
          <Chair pos={[a.pos[0], 0, a.pos[2] - 0.6]} />
        </group>
      ))}
      {AGENTS.map(a => (
        <AgentFigure
          key={a.id}
          agent={a}
          isActive={a.id === activeAgentId}
          onClick={() => onAgentClick(a.id)}
          taskStatus={activeAgents.includes(a.id) ? task.status : undefined}
        />
      ))}
      <Particles />
    </>
  )
}

// ─── Главный компонент ────────────────────────────────────────────────────────

export default function AgentOffice3D({ task }: { task: AgentTask }) {
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const activeAgent = AGENTS.find(a => a.id === activeAgentId)
  const statusColor = task.status === 'running' ? '#22d3ee' : task.status === 'completed' ? '#34d399' : task.status === 'failed' ? '#f87171' : '#6366f1'

  const handleAgentClick = (id: string) => setActiveAgentId(prev => prev === id ? null : id)

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#02020d' }}>
      <Canvas
        shadows
        camera={{ position: [0, 4, 10], fov: 52 }}
        gl={{ antialias: true }}
      >
        <Scene task={task} activeAgentId={activeAgentId} onAgentClick={handleAgentClick} />
      </Canvas>

      {/* Инфо задачи */}
      <div style={{ position: 'absolute', top: 12, left: 14, pointerEvents: 'none', background: 'rgba(4,4,18,0.85)', backdropFilter: 'blur(12px)', border: `1px solid ${statusColor}35`, borderRadius: 10, padding: '8px 14px', maxWidth: 260 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
        <div style={{ fontSize: 10, color: statusColor }}>● {(task.status || 'queued').toUpperCase()}</div>
      </div>

      {/* Легенда агентов */}
      <div style={{ position: 'absolute', top: 12, right: 14, pointerEvents: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {AGENTS.map(a => (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: a.color, flexShrink: 0, boxShadow: `0 0 5px ${a.color}` }} />
            {a.name}
          </div>
        ))}
      </div>

      {/* Подсказка */}
      <div style={{ position: 'absolute', bottom: activeAgent ? 76 : 10, left: '50%', transform: 'translateX(-50%)', fontSize: 10, color: 'rgba(255,255,255,0.18)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
        Тяни для вращения • Колесо для зума • Клик на агента
      </div>

      {/* Панель активного агента */}
      {activeAgent && (
        <div style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', background: 'rgba(4,4,18,0.92)', backdropFilter: 'blur(16px)', border: `1px solid ${activeAgent.color}40`, borderRadius: 14, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 14, minWidth: 260, boxShadow: `0 0 24px ${activeAgent.color}25` }}>
          <div style={{ width: 38, height: 38, borderRadius: '50%', background: `linear-gradient(135deg,${activeAgent.color},${activeAgent.color}88)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 18 }}>🤖</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 2 }}>{activeAgent.name}</div>
            <div style={{ fontSize: 11, color: activeAgent.color }}>{activeAgent.role}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>
              {activeAgent.activity === 'running' ? '⚡ Выполняет задачу' : activeAgent.activity === 'working' ? '💻 Пишет код' : activeAgent.activity === 'meeting' ? '💬 На совещании' : '😴 Ожидает'}
            </div>
          </div>
          <button onClick={() => setActiveAgentId(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 16, padding: 4 }}>✕</button>
        </div>
      )}
    </div>
  )
}
