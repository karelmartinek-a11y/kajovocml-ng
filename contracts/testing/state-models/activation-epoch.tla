---- MODULE activation_epoch ----
EXTENDS Naturals
VARIABLES epoch, activeRelease, observedEpoch
vars == <<epoch, activeRelease, observedEpoch>>
Init == /\ epoch = 0 /\ activeRelease = "bootstrap" /\ observedEpoch = 0
Activate(release) == /\ epoch' = epoch + 1 /\ activeRelease' = release /\ observedEpoch' = observedEpoch
Observe == /\ observedEpoch' = epoch /\ UNCHANGED <<epoch, activeRelease>>
Next == (\E release \in STRING: Activate(release)) \/ Observe
NoFutureObservation == observedEpoch <= epoch
Spec == Init /\ [][Next]_vars
====
