## Design considerations

## v0.2.0 (initial notes)

Given the fact that this will require a large number of accounts, I thought about using zkcompression, where accounts are much cheaper to create (they use ledger storage). That however only delays the cost.

zkcompressed accounts are more expensive to update - validators will need to be compensated - and have a higher compute cost, meaning you will be able to take on fewer operations per transaction. This means Morat would need to do a *ton* of transactions for the decay function.

Given decay is a fundamental part of it, and something that the system itself needs to do, then that's a no-go.

An option would be doing this using raw Solana accounts, but the rent cost would be prohibitive. Storing 2MB costs about 0.015 SOL to keep rent-free, and if someone has a lot of point assignment from different users, that means I'd likely need to map the users to a hashed version, thus losing some of the tracking anyway.

We want to lose as little detail on point assignment as possible, given a user's current point tally *and point sources* are fundamental to develop a local view (otherwise we could just keep an account with a total).

So my current thinking is more along the lines of a validium.

In broad strokes:

- Implement all point assignment, tracking, and decay, off-chain;
- A user indicates they want to assign points to a different one by sending a signed message (no cost, can be verified);
- Periodically log aggregated proofs on-chain, or to some other permanent mechanism.

Simply tracking point assignments via signed statements, independent of underlying storage, would have the added advantage that it becomes cross-platform - anyone can register with any type of public key, and assign points to any other public key *regardless of where the private key for the corresponding user lives*.

Say ... you register with a Solana public key, sign a message, and assign points to someone with a BlueSky DID or an Ethereum address.

I *briefly* considered an AppChain. The overhead and cost currently seem unnecessary at this point.

### TODO

- [x] Allow for opt in - user A will not automatically get points from users they did not opt in to;
- [x] Allow users to keep a list of other blocked users;
- [x] Allow users to users to opt in to anyone except blocked users;
- [ ] Decay unclaimed points on claim - if a point assignment from epoch X gets claimed on X+2, it gets decayed as if it had been assigned on X and then gone through the normal process;

### Things to figure out

- It still remains to be defined how to make this sustainable. Even if this is stored on IPFS documents somewhere which expire after X epochs, *someone* will need to be able to cover those costs for as long as they are pinned.

## v0.1.0

### TODO

OK, things to do here...

- [x] Tick a new epoch
- [x] Allow registration of a new user
- [x] Every new user gets 1k points per epoch
- [x] Allow a user to transfer points to another user
- [x] Allow querying of current user points
- [x] User's own points refill on epoch tick
- [x] User's assigned points decay on epoch tick

We'll do all of these in memory for now. This is a prototype.

If this is going to end up running on Solana, it will likely need account compression in order to save on storage costs, or we can possibly reduce the number of bits used for the `fromKey` to 16 bits - there will be some collisions, but that's fine if we don't care about too precise a tracking of where the points came from.
 