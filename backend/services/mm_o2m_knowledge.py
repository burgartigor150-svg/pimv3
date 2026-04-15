import json
import os
import threading

MEMORY_FILE = "experience_memory.json"

class KnowledgeStore:
    def __init__(self, file_path=MEMORY_FILE):
        self.file_path = file_path
        self.lock = threading.Lock()
        self.memory = self._load()
        if "lessons" not in self.memory: self.memory["lessons"] = {}
        if "rules" not in self.memory: self.memory["rules"] = []
        if "cat_memory" not in self.memory: self.memory["cat_memory"] = {}
        
        # Initialize with known platform rules if empty
        if not self.memory["rules"]:
            self._init_default_rules()

    def _load(self):
        if os.path.exists(self.file_path):
            try:
                with open(self.file_path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                return {}
        return {}

    def _save(self):
        with self.lock:
            with open(self.file_path, 'w', encoding='utf-8') as f:
                json.dump(self.memory, f, ensure_ascii=False, indent=2)

    def _init_default_rules(self):
        default_rules = [
            {"topic": "Name Limit", "rule": "Product name field MUST NOT exceed 90 characters. Shorten if necessary."},
            {"topic": "Photos", "rule": "Maximum 15 photos allowed. First photo is the main one."},
            {"topic": "Dimensions", "rule": "Megamarket expects dimensions in CM, but Ozon provides MM. Convert MM to CM (divide by 10)."},
            {"topic": "Weight", "rule": "Megamarket expects weight in GRAMS. Maintain grams from Ozon or convert if needed."},
            {"topic": "Barcodes", "rule": "Use 'barcodes' (plural) field in the payload, even for a single barcode."},
            {"topic": "TV OS", "rule": "For TVs, identify OS (Tizen, WebOS, Android TV) from description if 'Операционная система' attribute is required."},
            {"topic": "Attribute Values", "rule": "Strictly match dictionaryList values if isSuggest is false. No approximations."},
        ]
        self.memory["rules"] = default_rules
        self._save()

    def save_experience(self, category_id, error_text, fix_logic):
        with self.lock:
            cat_key = str(category_id)
            if cat_key not in self.memory["lessons"]:
                self.memory["lessons"][cat_key] = []
            
            for exp in self.memory["lessons"][cat_key]:
                if exp['error_text'] == error_text:
                    return

            self.memory["lessons"][cat_key].append({
                "error_text": error_text,
                "fix_logic": fix_logic
            })
            # Skip file save here to avoid I/O jam, we'll save in cat match or periodically
            # Actually, let's keep it but with lock it's safer.
            # self._save() # This would cause double lock if _save also has lock.
        
        # Call _save outside the first lock to avoid re-entrancy if _save has its own lock
        self._save()
        print(f"[Memory] Recorded new lesson for category {category_id}")

    def get_relevant_knowledge(self, category_id):
        cat_key = str(category_id)
        return self.memory["lessons"].get(cat_key, [])

    def get_all_rules(self):
        return self.memory["rules"]

    def save_category_match(self, ozon_name, category_id):
        with self.lock:
            self.memory["cat_memory"][ozon_name] = category_id
        self._save()

    def find_remembered_category(self, ozon_name):
        return self.memory["cat_memory"].get(ozon_name)

# Global singleton
knowledge_store = KnowledgeStore()
