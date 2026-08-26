# Slow Garden contracts

`v1/` is the platform-neutral source for records exchanged by the future iOS and web clients. The local native milestone does not send these envelopes over a network; its domain names and fixtures are kept aligned now so later sync work does not redefine provenance.

- Source text lives only in source/revision payloads.
- Queue and outbox metadata use identifiers, state, and hashes—not note bodies.
- A bloom must cite exactly three revision IDs in the fixture workflow and never more than three in any workflow.
- Unknown enum values fail decoding until a deliberate contract version adds them.
