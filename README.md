# Morat - Reference implementation

This is a trivial initial implementation of the system described on the accompanying [this document](Reputation.md), and initially published on [this gist](https://gist.github.com/ricardojmendez/f63e50203486df54cd779971edab5681).

Everything is kept in memory. The focus is on testing the mechanics on an easy to change enviroment.


## Development

To start the development server run:

```bash
bun run dev --watch
```

The REST API is running at http://localhost:3000/ - check [`index.ts`](src/index.ts) for the current implementation.

## Behavior notes

As of v0.1.0, the behavior fills all the basic criteria I expect from my initial notes. Using v0.1.0 of the [agent swarm](https://github.com/Numergent/morat-agents/tree/v0.1.0), we find that even after a few thousand epochs:

- The decay rate helps handle potential runaway leader issues;
- No particular account comes to dominate, even if they have a large number of users giving them points;
- Morat's own account doesn't get an overwhelming amount of points, even when some users do large transfers, given the fact that they only act as a sink on transfers over 100 and will decay along with everyone else;

![Point tally](images/tally-screenshot-0.1.0.png)


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
 