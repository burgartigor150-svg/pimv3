from typing import Dict, Any, List
from backend.models import Attribute

def calculate_completeness(attributes_data: Dict[str, Any], required_attributes: List[Attribute]) -> int:
    if not required_attributes:
        return 100
    
    filled_count = 0
    for attr in required_attributes:
        val = attributes_data.get(attr.code)
        if val is not None and val != "":
            filled_count += 1
            
    return int((filled_count / len(required_attributes)) * 100)
