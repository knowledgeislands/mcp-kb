# Outgoing trades

This directory holds sender-owned cross-repository work and knowledge preparations and submitted trades, grouped by the receiver's canonical `owner/repo` identity. A record's own `phase` field carries its state: a mutable preparation declares `phase: preparing`, and submission rewrites that field to `phase: submitted` in place and freezes the record.

Only this repository writes or removes these records. A submitted trade's observation policy determines whether receipt, a terminal decision, or completion of adopted local work permits release.

An outbound record may await the receiver's `ki-trades` participation and matching import declaration. It remains sender-owned until an inbound copy is observable.
