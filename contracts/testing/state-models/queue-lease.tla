---- MODULE queue_lease ----
EXTENDS Naturals, Sequences, FiniteSets
CONSTANT Workers
VARIABLES state, owner, fence
vars == <<state, owner, fence>>
Init == /\ state = "READY" /\ owner = "NONE" /\ fence = 0
Claim(w) == /\ state = "READY" /\ w \in Workers /\ state' = "CLAIMED" /\ owner' = w /\ fence' = fence + 1
Complete(w, f) == /\ state = "CLAIMED" /\ owner = w /\ fence = f /\ state' = "SUCCEEDED" /\ UNCHANGED <<owner, fence>>
Next == (\E w \in Workers: Claim(w)) \/ (\E w \in Workers, f \in Nat: Complete(w, f))
TypeInvariant == /\ state \in {"READY", "CLAIMED", "SUCCEEDED"} /\ fence \in Nat
Fencing == state = "SUCCEEDED" => fence > 0
Spec == Init /\ [][Next]_vars
====

