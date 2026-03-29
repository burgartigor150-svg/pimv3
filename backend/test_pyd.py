from pydantic import BaseModel
from typing import Dict, Any
class SyndicatePushRequest(BaseModel):
    product_id: int
    mapped_payload: Dict[str, Any]

req = SyndicatePushRequest(product_id=123, mapped_payload={"type":"Соло"})
req.mapped_payload["offerId"] = str(req.product_id)
print(req.mapped_payload)
