# Outgoing trades

This directory holds sender-owned cross-repository work and knowledge preparations and submitted trades, grouped by the receiver's canonical `owner/repo` identity. A record's own `phase` field carries its state: a mutable preparation declares `phase: preparing`, and submission rewrites that field to `phase: submitted` in place and freezes the record.

Only this repository writes or removes these records. Knowledge uses receipt; work uses decision or completion. A submitted trade remains submitted while its selected observation is unsatisfied; sender release removes the outbound projection.

An outbound record may await the receiver's `ki-trades` participation and matching import declaration. It remains sender-owned until an inbound copy is observable.
