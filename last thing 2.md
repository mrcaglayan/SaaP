No, not directly.

Current behavior is:

document reversal only allows POSTED documents, enforced in cari.document.service.js (line 2683) and specifically at cari.document.service.js (line 2702)
settlement recalculates document status to PARTIALLY_SETTLED or SETTLED, and only puts it back to POSTED when the residual reopens fully, in cari.settlement.service.js (line 3396), cari.settlement.service.js (line 3451), and cari.settlement.service.js (line 3453)
So the supported flow is:

Reverse the settlement first via cari.js (line 217)
That can reopen the document back to POSTED
Then reverse the document via cari.document.routes.js (line 253)
Important caveats:

settlement reversal is blocked if a linked cash transaction is still POSTED, see cari.settlement.service.js (line 5840)
it can also fail if later operations already changed the open item or unapplied cash state, see cari.settlement.service.js (line 5951) and cari.settlement.service.js (line 6072)
If you want, I can map the exact UI/backend steps for “settled document -> reverse settlement -> reverse document” next, still without editing code.


