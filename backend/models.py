import uuid
from sqlalchemy import Column, String, Boolean, ForeignKey, Text, Integer
from sqlalchemy.dialects.postgresql import UUID, JSONB
from backend.database import Base
from sqlalchemy.orm import relationship, backref

class Category(Base):
    __tablename__ = "categories"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("categories.id"), nullable=True)

    products = relationship("Product", back_populates="category")
    subcategories = relationship("Category", backref=backref('parent', remote_side=[id]))

class Attribute(Base):
    __tablename__ = "attributes"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False) # UI Label
    type = Column(String, nullable=False) # string, number, boolean, select
    is_required = Column(Boolean, default=False)
    category_id = Column(UUID(as_uuid=True), ForeignKey("categories.id"), nullable=True)
    connection_id = Column(UUID(as_uuid=True), ForeignKey("marketplace_connections.id"), nullable=True)

    category = relationship("Category", backref="attributes", lazy="selectin")
    connection = relationship("MarketplaceConnection", backref="attributes", lazy="selectin")

class Product(Base):
    __tablename__ = "products"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sku = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    category_id = Column(UUID(as_uuid=True), ForeignKey("categories.id"))
    description_html = Column(Text, nullable=True)
    attributes_data = Column(JSONB, default={}) # Stores key-value based on attribute codes
    images = Column(JSONB, default=[]) # List of image URLs
    completeness_score = Column(Integer, default=0)

    category = relationship("Category", back_populates="products", lazy="selectin")

class MarketplaceConnection(Base):
    __tablename__ = "marketplace_connections"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    type = Column(String, nullable=False) # ozon, yandex, megamarket, wildberries
    name = Column(String, nullable=False)
    api_key = Column(String, nullable=False)
    client_id = Column(String, nullable=True)
    store_id = Column(String, nullable=True)
    # Мегамаркет Assortment API: locationId склада для price/* и stock/*
    warehouse_id = Column(String, nullable=True)

class SystemSettings(Base):
    __tablename__ = "system_settings"
    id = Column(String, primary_key=True, index=True) # e.g. 'deepseek_api_key'
    value = Column(String, nullable=False)
    description = Column(String, nullable=True)

class User(Base):
    __tablename__ = "users"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    role = Column(String, default="admin") # For now everyone is admin unless specifically restricted

class CategoryMapping(Base):
    __tablename__ = "category_mappings"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_type = Column(String, nullable=False) # e.g. "ozon"
    target_type = Column(String, default="megamarket")
    source_cat_id = Column(String, nullable=False) 
    target_cat_id = Column(String, nullable=True) 
    source_name = Column(String, nullable=True)
    target_name = Column(String, nullable=True)
    ai_confidence = Column(Integer, default=0)
    is_approved = Column(Boolean, default=False)

class AttributeMapping(Base):
    __tablename__ = "attribute_mappings"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    category_mapping_id = Column(UUID(as_uuid=True), ForeignKey("category_mappings.id", ondelete="CASCADE"))
    source_attr_id = Column(String, nullable=False)
    target_attr_id = Column(String, nullable=False)
    source_attr_name = Column(String, nullable=True)
    target_attr_name = Column(String, nullable=True)

class DictionaryMapping(Base):
    __tablename__ = "dictionary_mappings"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    attribute_mapping_id = Column(UUID(as_uuid=True), ForeignKey("attribute_mappings.id", ondelete="CASCADE"))
    source_value_id = Column(String, nullable=True) # or literal string value
    source_value = Column(String, nullable=True)
    target_value_id = Column(String, nullable=False)
    target_value = Column(String, nullable=True)

class MarketplaceDictionary(Base):
    __tablename__ = "marketplace_dictionaries"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    connection_type = Column(String, nullable=False) # e.g. "megamarket"
    category_id = Column(String, nullable=False)
    attribute_id = Column(String, nullable=False)
    dictionary_value_id = Column(String, nullable=False)
    value = Column(String, nullable=False)
