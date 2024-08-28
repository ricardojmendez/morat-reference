# Morat - Reference implementation

This is a trivial initial implementation of the system described on the accompanying [this document](Reputation.md), and initially published on [this gist](https://gist.github.com/ricardojmendez/f63e50203486df54cd779971edab5681).

Everything is kept in memory. The focus is on testing the mechanics on an easy to change enviroment.


## Development

To start the development server run:

```bash
bun run dev --watch
```

The REST API is running at http://localhost:3000/ - check [`index.ts`](src/index.ts) for the current implementation.

## TODO

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
 