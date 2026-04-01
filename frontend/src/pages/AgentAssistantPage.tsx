import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  KeyboardEvent,
} from 'react';
import { Bot, Send, Plus, Trash2, MessageSquare, ChevronDown, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MODELS = [
  { value: 'deepseek-chat', label: 'DeepSeek Chat' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { value: 'qwen3:14b', label: 'Qwen3 14B (Local)' },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

const TypingIndicator: React.FC = () => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '4px 0' }}>
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #6366f1, #a855f7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: '0 0 14px rgba(99,102,241,0.45)',
      }}
    >
      <Bot size={16} color="#fff" />
    </div>
    <div
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        borderBottomLeftRadius: 4,
        backdropFilter: 'blur(20px)',
        padding: '12px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'rgba(99,102,241,0.85)',
            display: 'inline-block',
            animation: 'typingBounce 1.2s ease-in-out infinite',
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </div>
  </div>
);

const UserMessage: React.FC<{ content: string; timestamp: Date }> = ({
  content,
  timestamp,
}) => (
  <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 0' }}>
    <div
      style={{
        maxWidth: '72%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 4,
      }}
    >
      <div
        style={{
          background: 'linear-gradient(135deg, #6366f1, #a855f7)',
          borderRadius: 16,
          borderBottomRightRadius: 4,
          padding: '12px 16px',
          color: 'rgba(255,255,255,0.97)',
          fontSize: 14,
          lineHeight: 1.65,
          boxShadow: '0 4px 24px rgba(99,102,241,0.3)',
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {content}
      </div>
      <span
        style={{
          fontSize: 11,
          color: 'rgba(255,255,255,0.22)',
          paddingRight: 4,
        }}
      >
        {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  </div>
);

const AssistantMessage: React.FC<{ content: string; timestamp: Date }> = ({
  content,
  timestamp,
}) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '4px 0' }}>
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #6366f1, #a855f7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: '0 0 14px rgba(99,102,241,0.45)',
        marginTop: 2,
      }}
    >
      <Bot size={16} color="#fff" />
    </div>
    <div
      style={{
        maxWidth: '72%',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16,
          borderBottomLeftRadius: 4,
          backdropFilter: 'blur(20px)',
          padding: '12px 16px',
          color: 'rgba(255,255,255,0.9)',
          fontSize: 14,
          lineHeight: 1.65,
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {content}
      </div>
      <span
        style={{
          fontSize: 11,
          color: 'rgba(255,255,255,0.22)',
          paddingLeft: 4,
        }}
      >
        {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────

const AgentAssistantPage: React.FC = () => {
  const { toast } = useToast();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] = useState('deepseek-chat');
  const [isLoading, setIsLoading] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── scroll ──────────────────────────────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  // ── bootstrap ───────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchConversations();
  }, []);

  // ── close model dropdown on outside click ───────────────────────────────────
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  // ── API helpers ──────────────────────────────────────────────────────────────
  const fetchConversations = async () => {
    try {
      const res = await api.get('/agent/assistant/conversations');
      const data = res.data;
      setConversations(Array.isArray(data) ? data : []);
    } catch {
      toast('Failed to load conversations', 'error');
    }
  };

  const handleNewConversation = () => {
    setActiveConversationId(null);
    setMessages([]);
    textareaRef.current?.focus();
  };

  const handleSelectConversation = (conv: Conversation) => {
    setActiveConversationId(conv.id);
    setMessages([]);
    textareaRef.current?.focus();
  };

  const handleDeleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      await api.delete(`/agent/assistant/conversations/${id}`);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversationId === id) {
        setActiveConversationId(null);
        setMessages([]);
      }
    } catch {
      toast('Failed to delete conversation', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const res = await api.post('/agent/assistant/chat', {
        message: trimmed,
        model: selectedModel,
        conversation_id: activeConversationId,
      });

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: res.data.reply,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMsg]);

      if (res.data.conversation_id && res.data.conversation_id !== activeConversationId) {
        setActiveConversationId(res.data.conversation_id);
        await fetchConversations();
      }
    } catch {
      toast('Failed to send message', 'error');
    } finally {
      setIsLoading(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  const currentModel = MODELS.find((m) => m.value === selectedModel) ?? MODELS[0];
  const activeTitle =
    activeConversationId
      ? conversations.find((c) => c.id === activeConversationId)?.title || 'Conversation'
      : 'New Conversation';

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Keyframe injections */}
      <style>{`
        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
          30% { transform: translateY(-6px); opacity: 1; }
        }
        @keyframes orbFloat1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%  { transform: translate(32px, -22px) scale(1.06); }
          66%  { transform: translate(-18px, 16px) scale(0.96); }
        }
        @keyframes orbFloat2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%  { transform: translate(-26px, 22px) scale(1.04); }
          66%  { transform: translate(22px, -16px) scale(0.97); }
        }
        .conv-item:hover .conv-delete-btn {
          opacity: 1 !important;
        }
        .aa-btn-glow {
          background: linear-gradient(135deg, #6366f1, #a855f7);
          border: none;
          border-radius: 12px;
          color: #fff;
          cursor: pointer;
          font-weight: 600;
          transition: box-shadow 0.2s, transform 0.12s, opacity 0.2s;
          box-shadow: 0 0 20px rgba(99,102,241,0.4);
        }
        .aa-btn-glow:hover:not(:disabled) {
          box-shadow: 0 0 36px rgba(99,102,241,0.65);
          transform: translateY(-1px);
        }
        .aa-btn-glow:active:not(:disabled) {
          transform: translateY(0);
        }
        .aa-btn-glow:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .aa-scroll::-webkit-scrollbar { width: 4px; }
        .aa-scroll::-webkit-scrollbar-track { background: transparent; }
        .aa-scroll::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.09);
          border-radius: 4px;
        }
        .aa-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.16);
        }
        .aa-textarea:focus { outline: none; }
        .aa-input-wrap:focus-within {
          border-color: rgba(99,102,241,0.42) !important;
          box-shadow: 0 0 0 1px rgba(99,102,241,0.14), 0 4px 28px rgba(99,102,241,0.1) !important;
        }
      `}</style>

      <div
        style={{
          display: 'flex',
          height: '100%',
          background: 'var(--bg-void, #03030a)',
          position: 'relative',
          overflow: 'hidden',
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        }}
      >
        {/* Ambient orbs */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: '8%',
            left: '14%',
            width: 560,
            height: 560,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(99,102,241,0.13) 0%, transparent 70%)',
            animation: 'orbFloat1 18s ease-in-out infinite',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />
        <div
          aria-hidden
          style={{
            position: 'absolute',
            bottom: '8%',
            right: '8%',
            width: 460,
            height: 460,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(168,85,247,0.11) 0%, transparent 70%)',
            animation: 'orbFloat2 23s ease-in-out infinite',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />

        {/* ── Sidebar ──────────────────────────────────────────────────────── */}
        <aside
          style={{
            width: 260,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            background: 'rgba(255,255,255,0.025)',
            borderRight: '1px solid rgba(255,255,255,0.07)',
            backdropFilter: 'blur(20px)',
            position: 'relative',
            zIndex: 1,
          }}
        >
          {/* Sidebar top */}
          <div
            style={{
              padding: '20px 14px 14px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 0 14px rgba(99,102,241,0.45)',
                  flexShrink: 0,
                }}
              >
                <Sparkles size={14} color="#fff" />
              </div>
              <span
                style={{
                  color: 'rgba(255,255,255,0.92)',
                  fontWeight: 700,
                  fontSize: 15,
                  letterSpacing: '-0.02em',
                }}
              >
                Assistant
              </span>
            </div>

            <button
              onClick={handleNewConversation}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '9px 12px',
                background: 'rgba(99,102,241,0.1)',
                border: '1px solid rgba(99,102,241,0.22)',
                borderRadius: 10,
                color: 'rgba(255,255,255,0.82)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'background 0.15s, border-color 0.15s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  'rgba(99,102,241,0.18)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  'rgba(99,102,241,0.1)';
              }}
            >
              <Plus size={15} />
              New conversation
            </button>
          </div>

          {/* Conversation list */}
          <div
            className="aa-scroll"
            style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}
          >
            {conversations.length === 0 ? (
              <p
                style={{
                  textAlign: 'center',
                  padding: '36px 12px',
                  color: 'rgba(255,255,255,0.22)',
                  fontSize: 13,
                  margin: 0,
                }}
              >
                No conversations yet
              </p>
            ) : (
              conversations.map((conv) => {
                const isActive = conv.id === activeConversationId;
                return (
                  <div
                    key={conv.id}
                    className="conv-item"
                    onClick={() => handleSelectConversation(conv)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '9px 10px',
                      borderRadius: 10,
                      cursor: 'pointer',
                      background: isActive
                        ? 'rgba(99,102,241,0.14)'
                        : 'transparent',
                      border: isActive
                        ? '1px solid rgba(99,102,241,0.22)'
                        : '1px solid transparent',
                      marginBottom: 2,
                      transition: 'background 0.15s',
                      position: 'relative',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive)
                        (e.currentTarget as HTMLDivElement).style.background =
                          'rgba(255,255,255,0.04)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive)
                        (e.currentTarget as HTMLDivElement).style.background =
                          'transparent';
                    }}
                  >
                    <MessageSquare
                      size={14}
                      color={isActive ? '#6366f1' : 'rgba(255,255,255,0.32)'}
                      style={{ flexShrink: 0 }}
                    />
                    <span
                      style={{
                        flex: 1,
                        fontSize: 13,
                        color: isActive
                          ? 'rgba(255,255,255,0.92)'
                          : 'rgba(255,255,255,0.52)',
                        fontWeight: isActive ? 500 : 400,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {conv.title || 'Untitled'}
                    </span>
                    <button
                      className="conv-delete-btn"
                      onClick={(e) => handleDeleteConversation(e, conv.id)}
                      disabled={deletingId === conv.id}
                      title="Delete conversation"
                      style={{
                        opacity: 0,
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 3,
                        color: 'rgba(248,113,113,0.7)',
                        display: 'flex',
                        alignItems: 'center',
                        transition: 'opacity 0.15s, color 0.15s',
                        flexShrink: 0,
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.color =
                          'rgba(248,113,113,1)';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.color =
                          'rgba(248,113,113,0.7)';
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* ── Main chat area ────────────────────────────────────────────────── */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            zIndex: 1,
            overflow: 'hidden',
          }}
        >
          {/* Top bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 28px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(255,255,255,0.015)',
              backdropFilter: 'blur(20px)',
              flexShrink: 0,
              gap: 12,
            }}
          >
            {/* Title */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                  boxShadow: '0 0 10px rgba(99,102,241,0.65)',
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  color: 'rgba(255,255,255,0.9)',
                  fontWeight: 600,
                  fontSize: 15,
                  letterSpacing: '-0.01em',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {activeTitle}
              </span>
            </div>

            {/* Model selector */}
            <div ref={dropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
              <button
                onClick={() => setModelDropdownOpen((o) => !o)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 13px',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 10,
                  color: 'rgba(255,255,255,0.72)',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'background 0.15s, border-color 0.15s',
                  backdropFilter: 'blur(10px)',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background =
                    'rgba(255,255,255,0.07)';
                  (e.currentTarget as HTMLButtonElement).style.borderColor =
                    'rgba(255,255,255,0.17)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background =
                    'rgba(255,255,255,0.04)';
                  (e.currentTarget as HTMLButtonElement).style.borderColor =
                    'rgba(255,255,255,0.1)';
                }}
              >
                {currentModel.label}
                <ChevronDown
                  size={14}
                  style={{
                    transition: 'transform 0.2s',
                    transform: modelDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    color: 'rgba(255,255,255,0.4)',
                  }}
                />
              </button>

              {modelDropdownOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    right: 0,
                    background: 'rgba(8,8,18,0.96)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 12,
                    backdropFilter: 'blur(20px)',
                    boxShadow: '0 8px 36px rgba(0,0,0,0.55)',
                    overflow: 'hidden',
                    zIndex: 50,
                    minWidth: 188,
                  }}
                >
                  {MODELS.map((model) => {
                    const active = selectedModel === model.value;
                    return (
                      <button
                        key={model.value}
                        onClick={() => {
                          setSelectedModel(model.value);
                          setModelDropdownOpen(false);
                        }}
                        style={{
                          width: '100%',
                          display: 'block',
                          padding: '10px 14px',
                          background: active ? 'rgba(99,102,241,0.14)' : 'transparent',
                          border: 'none',
                          color: active
                            ? 'rgba(255,255,255,0.95)'
                            : 'rgba(255,255,255,0.62)',
                          fontSize: 13,
                          fontWeight: active ? 600 : 400,
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'background 0.12s',
                        }}
                        onMouseEnter={(e) => {
                          if (!active)
                            (e.currentTarget as HTMLButtonElement).style.background =
                              'rgba(255,255,255,0.05)';
                        }}
                        onMouseLeave={(e) => {
                          if (!active)
                            (e.currentTarget as HTMLButtonElement).style.background =
                              'transparent';
                        }}
                      >
                        {model.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Messages area */}
          <div
            className="aa-scroll"
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '28px 36px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {messages.length === 0 && !isLoading && (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 18,
                  paddingBottom: 80,
                }}
              >
                <div
                  style={{
                    width: 68,
                    height: 68,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 0 40px rgba(99,102,241,0.42)',
                  }}
                >
                  <Bot size={30} color="#fff" />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <p
                    style={{
                      color: 'rgba(255,255,255,0.72)',
                      fontSize: 19,
                      fontWeight: 700,
                      margin: '0 0 8px',
                      letterSpacing: '-0.025em',
                    }}
                  >
                    How can I help you today?
                  </p>
                  <p
                    style={{
                      color: 'rgba(255,255,255,0.28)',
                      fontSize: 13,
                      margin: 0,
                    }}
                  >
                    Press <kbd style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, padding: '1px 5px', fontSize: 12, fontFamily: 'monospace' }}>⌘ Enter</kbd> to send
                  </p>
                </div>
              </div>
            )}

            {messages.map((msg) =>
              msg.role === 'user' ? (
                <UserMessage
                  key={msg.id}
                  content={msg.content}
                  timestamp={msg.timestamp}
                />
              ) : (
                <AssistantMessage
                  key={msg.id}
                  content={msg.content}
                  timestamp={msg.timestamp}
                />
              ),
            )}

            {isLoading && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div
            style={{
              padding: '14px 28px 22px',
              borderTop: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(255,255,255,0.012)',
              backdropFilter: 'blur(20px)',
              flexShrink: 0,
            }}
          >
            <div
              className="aa-input-wrap"
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 10,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 16,
                padding: '10px 10px 10px 16px',
                backdropFilter: 'blur(20px)',
                transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
            >
              <textarea
                ref={textareaRef}
                className="aa-textarea"
                value={input}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                placeholder="Message assistant… (⌘ Enter to send)"
                rows={1}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  resize: 'none',
                  color: 'rgba(255,255,255,0.9)',
                  fontSize: 14,
                  lineHeight: 1.65,
                  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                  minHeight: 24,
                  maxHeight: 160,
                  overflowY: 'auto',
                  paddingTop: 1,
                }}
              />
              <button
                className="aa-btn-glow"
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                title="Send (⌘ Enter)"
                style={{
                  width: 40,
                  height: 40,
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  borderRadius: 12,
                }}
              >
                <Send size={16} />
              </button>
            </div>

            <p
              style={{
                textAlign: 'center',
                fontSize: 11,
                color: 'rgba(255,255,255,0.18)',
                margin: '8px 0 0',
                letterSpacing: '0.01em',
              }}
            >
              AI responses may contain errors. Verify important information.
            </p>
          </div>
        </div>
      </div>
    </>
  );
};

export default AgentAssistantPage;
