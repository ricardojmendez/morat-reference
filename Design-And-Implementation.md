## Design considerations

## V0.3.0 (WIP)

We now use Postgres for durable storage. I've run a few tests feeding Morat from the BlueSky Like event stream and I see points spreading through the network as expected.

It has highlighted that, in an environment where a few accounts are very popular, we may end up with accounts that have points assigned from a multitude of accounts.

This table shows the distinct point assignments for only a few accounts:

```
 count |             ownerId
-------+----------------------------------
  8601 | did:plc:z72i7hdynmk6r22z27h6tvur
  6957 | did:plc:ss7zmsfvuw5wwxefvz5flgbb
  6369 | did:plc:rugfznmdhcczrhwdtrod4dnt
  6247 | did:plc:acvjxnp5fsqoq4fwri6wuqj7
  5603 | did:plc:mf5dzzqkp7fnmby6blfeljwj
  5343 | did:plc:cxlosfkytw7r75f7wlm3dn7p
  4934 | did:plc:mymwxdm4zedrqufkotuxn72k
  4887 | did:plc:nvfposmpmhegtyvhbs75s3pw
  4671 | did:plc:jt72xztklu3d2chvll2hizr6
  4415 | did:plc:sndurg3enuxjr2y36nwta2pa
```

If one of these accounts were in turn to send points to someone, these accounts would in turn end up with thousands of new points assignments created for them.

This data explosion is not only going to make custom scores slow to calculate, but likely also adds a significant amount of noise - we likely only care about the top N contributors of points to an account, and can lump the bottom into an "others" category. That would also likely make this a better fit for storage systems other than a monster RDBMs.

Considerations:

- What is a sensible number of top N point contributors likely varies from scenario to scenario.
- If an account already has large volume contributors, this would mean that a new account that starts sending them points would always end up lumped into *Others*. It seems that we need to keep the point detail for an epoch, and then only summarize at the end of it, when decaying the points.
- It's unclear if propagating points from *Others* has any informational value - we may only want to propagate points from the identifiable accounts.

See also the new [Performance Considerations](Performance-considerations.md) document.


## v0.2.0

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
- [x] Prune unclaimed points after they would have fully decayed;
- [x] Decay unclaimed points on claim - if a point assignment from epoch X gets claimed on X+2, it gets decayed as if it had been assigned on X and then gone through the normal process;

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
 