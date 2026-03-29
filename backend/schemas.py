from pydantic import BaseModel, Field, ConfigDict
from typing import Dict, Any, Optional
from uuid import UUID

class CategoryBase(BaseModel):
    name: str

class CategoryCreate(CategoryBase):
    pass

class Category(CategoryBase):
    id: UUID
    parent_id: Optional[UUID] = None
    model_config = ConfigDict(from_attributes=True)

class MarketplaceConnectionBase(BaseModel):
    type: str
    name: str
    api_key: str
    client_id: Optional[str] = None
    store_id: Optional[str] = None
    warehouse_id: Optional[str] = None

class MarketplaceConnectionCreate(MarketplaceConnectionBase):
    pass

class MarketplaceConnection(MarketplaceConnectionBase):
    id: UUID
    model_config = ConfigDict(from_attributes=True)

class AttributeBase(BaseModel):
    code: str
    name: str
    type: str # string, number, boolean, select
    is_required: bool = False
    category_id: Optional[UUID] = None
    connection_id: Optional[UUID] = None

class AttributeCreate(AttributeBase):
    pass

class Attribute(AttributeBase):
    id: UUID
    category: Optional[Category] = None
    connection: Optional[MarketplaceConnection] = None
    model_config = ConfigDict(from_attributes=True)

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    current_path: Optional[str] = None

class ProductBase(BaseModel):
    sku: str
    name: str
    category_id: Optional[UUID] = None
    description_html: Optional[str] = None
    attributes_data: Optional[Dict[str, Any]] = {}
    images: Optional[list] = Field(default_factory=list)

class ProductCreate(ProductBase):
    pass

class ProductUpdate(BaseModel):
    sku: Optional[str] = None
    name: Optional[str] = None
    category_id: Optional[UUID] = None
    description_html: Optional[str] = None
    attributes_data: Optional[Dict[str, Any]] = None
    images: Optional[list] = None

class Product(ProductBase):
    id: UUID
    completeness_score: int = 0
    category: Optional[Category] = None
    model_config = ConfigDict(from_attributes=True)

class AIExtractRequest(BaseModel):
    text: str

class AIGenerateRequest(BaseModel):
    product_id: UUID

class SyndicateBaseRequest(BaseModel):
    product_id: UUID

class SyndicateMapRequest(BaseModel):
    product_id: UUID
    connection_id: UUID

class SyndicateOzonAgentRequest(BaseModel):
    """ИИ-агент с инструментами (схема, словари, ошибки, submit) для выгрузки в Ozon."""
    product_id: UUID
    connection_id: UUID
    category_id: Optional[str] = None  # desc_type; пусто — авто-подбор как в /syndicate/map
    push: bool = True
    public_base_url: Optional[str] = None  # origin для относительных путей картинок

class SyndicateAgentRequest(BaseModel):
    """Универсальный агент синдикации: адаптируется под выбранный маркетплейс."""
    product_id: UUID
    connection_id: UUID
    category_id: Optional[str] = None
    push: bool = True
    public_base_url: Optional[str] = None
    mapped_payload: Optional[Dict[str, Any]] = None
    mm_price_rubles: Optional[float] = None
    mm_stock_quantity: Optional[int] = None

class SyndicatePushRequest(BaseModel):
    product_id: str
    connection_id: str
    mapped_payload: Dict[str, Any]
    # Опционально после card/save (док. MM: отдельные методы price/stock)
    mm_price_rubles: Optional[float] = None
    mm_stock_quantity: Optional[int] = None
    public_base_url: Optional[str] = None

class ImportRequest(BaseModel):
    connection_id: str
    query: str

class BulkImportRequest(BaseModel):
    connection_id: UUID
    queries: list[str]

class BulkSyndicateRequest(BaseModel):
    connection_id: UUID
    product_ids: list[UUID]

class MegamarketAutoFixExistingRequest(BaseModel):
    connection_id: UUID
    scan_limit: int = 150

class BulkGenerateRequest(BaseModel):
    product_ids: list[UUID]

class SystemSettingUpdate(BaseModel):
    value: str

class SystemSettingResponse(BaseModel):
    id: str
    value: str
    description: str | None = None
    model_config = ConfigDict(from_attributes=True)


class SelfRewriteRunRequest(BaseModel):
    task_id: str
    allowlist_files: list[str] = Field(default_factory=lambda: [
        "backend/celery_worker.py",
        "backend/services/megamarket_syndicate_agent.py",
        "backend/services/megamarket_reviewer_agent.py",
        "backend/services/megamarket_verifier_agent.py",
        "backend/services/adapters.py",
        "backend/services/ai_service.py",
    ])
    apply_patch: bool = False
    run_frontend_build: bool = False


class AttributeStarMapBuildRequest(BaseModel):
    ozon_connection_id: UUID
    megamarket_connection_id: UUID
    max_ozon_categories: Optional[int] = None
    max_megamarket_categories: Optional[int] = None
    edge_threshold: float = 0.58


class AttributeStarMapManualOverrideRequest(BaseModel):
    from_name: str
    to_name: str
    from_category_id: Optional[str] = None
    to_category_id: Optional[str] = None
    from_attribute_id: Optional[str] = None
    to_attribute_id: Optional[str] = None
    score: float = 1.0


class KnowledgeIngestUrlRequest(BaseModel):
    namespace: str
    url: str
    title: Optional[str] = None


class KnowledgeSearchRequest(BaseModel):
    namespace: str
    query: str
    limit: int = 8


class TeamPlanCreateRequest(BaseModel):
    topic: str


class TeamTaskCreateRequest(BaseModel):
    plan_id: str
    role: str
    title: str
    details: str = ""


class TeamQuestionCreateRequest(BaseModel):
    plan_id: str
    asked_by: str
    question: str


class TeamQuestionAnswerRequest(BaseModel):
    plan_id: str
    question_id: str
    answer: str
    answered_by: str


class ApprovalRequestCreate(BaseModel):
    action: str
    payload: Dict[str, Any] = Field(default_factory=dict)


class ApprovalDecisionRequest(BaseModel):
    approval_id: str
    decision: str  # approved | rejected


class SelfImproveManualTriggerRequest(BaseModel):
    sku: str
    task_id: str
    error_excerpt: str = ""


class GithubConnectRequest(BaseModel):
    repo_url: str
    reason: str = ""


class AgentTaskCreateRequest(BaseModel):
    task_type: str = "backend"  # design | backend | api-integration | docs-ingest
    title: str
    description: str = ""
    namespace: Optional[str] = None
    docs_urls: list[str] = Field(default_factory=list)
    local_paths: list[str] = Field(default_factory=list)
    validation_query: Optional[str] = None
    web_query: Optional[str] = None
    max_web_results: int = 5
    requested_by_role: str = "project_manager"
    auto_run: bool = True


class AgentChatMessageRequest(BaseModel):
    message: str
    docs_urls: list[str] = Field(default_factory=list)
    history: list[ChatMessage] = Field(default_factory=list)
    auto_run: bool = True


class HelperAgentCreateRequest(BaseModel):
    name: str
    role: str
    goal: str
    tools: list[str] = Field(default_factory=list)
    parent_task_id: str = ""
