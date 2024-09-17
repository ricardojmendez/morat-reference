# Reputation system - Basic, very rough draft

## Goals

Primarily:

- Have a reputation system that indicates how much trust does someone have in a community. 
- Have the system be easily quantifiable.
- Do not provide a single view of the world, or what could be considered a "high score problem" - someone having a lot of kudos doesn't mean that *you* should trust them (trust is relative, and it might depend on if you trust people who trust them).
- Avoid reputation points to become an easily-tradeable currency - they should not be money.
- Let this reputation decay with time - someone doing something popular at some point in the far past doesn't mean that reputation should carry forward.

The last two are particularly important - while *Down And Out In the Magic Kingdom*'s Whuffie sounded like a fun idea when I first encountered it, there are a lot of aspects of it I can see that would be an issue after seeing years of behavior in the crypto space:

- It doesn't decay, so popularity at one point in the past implies you still have that value;
- Durable reputation across time leads to a "rich get richer" situation, because people will flock to those with an ever-growing score;
- If it looks like money, it will be gamed like an airdrop;
- If it looks like money, it will likely subvert what should be intrinsic motivation and turn them into extrinsic rewards (and those are less durable).

Ideal, but not required:

- Sybil-resistant, although that is a separate problem.
- Allows for privacy.

I'll focus this basic draft on describing an approach to solve the primary goals.

## Method
 
- Every user gets a certain number of raw, unassigned points every epoch - let's go with 100 weekly points for the example.
- Any points a user spends during that week get replenished at the start of the next epoch.
- A user can send points to another user at any moment.
- A user can hold a combination of source points (up to his maximum for that epoch) and points they have received from other users. Only points received from users are likely to be considered for reputation score.
- When user A sends points to user B, what B receives is a proportional combination of "raw" unassigned points that A holds, and the points that A has received from other users.
- Point assignments cannot be taken back.
- When a user gets points from another: the source pointers from the sender are tagged with them as the origin; the points the sender got from other users and then forwarded retain their original tag.
- Assigned point fractions below a certain minimum threshold are garbage-collected.
- A user cannot receive back points tagged with their own source - those are discarded.

Example follows. We will use α for any source points, and consider only integer points for transfer (rounding).

| # | Action | User A | User B | User C | User D |
|-|-|-|-|-|-|
| 0 | Start | 100α | 100α | 100α | 100α |
| 1 | A-10->B | 90α | 100α, 10A |  100α | 100α |
| 2 | D->10->C| 90α | 100α, 10A |  100α, 10D | 90α |
| 3 | B->20->C| 90α | 82α, 8A |  100α, 10D, 18B, 2A | 90α |
| 4 | C->100->A| 90α,77C,8D,14B| 82α, 8A |24α,3D,4B,2A|90α|
| 5 | A->50->D| 66α,57C,6D,10B| 82α, 8A |24α,3D,4B,2A|90α,24A,20C,4B|

### Notes

On the transfers:

- In 4, it only transferred 99 points both because the amount of A points would have been too low, and because A cannot receive A points. However, if the amount of A points would have been high enough, these would have been deducted and discarded.
- We can see this in 5, where 2D points get deducted and discarded.

On the goals:

- We can see this is similar to an UTXO system, with some constraints (there are rules on how things are transferred and choice is not arbitrary).
- Given these are UTXOs, and the amounts are always accounted for and controlled by the contract, decaying them through time by any desirable measure becomes easier (even if the UTXO approach adds overhead once the network grows, because the outputs aren't collapsible.)
- The fact that they are UTXOs and tracked individually has an added advantage: there is no single "reputation score" tally for a user, and anyone could write their own reputation heuristic for user A based on the raw data of assigned points for A (potentially even considering transfer history or deciding to discounts point from a source).
- Having multiple reputation heuristics available would ideally further discourage people viewing this as money or as a fixed score to be maximized, thus helping defuse the extrinsic reward threat.
- One could argue that on step 5 above it is unfair that A gets the full 50 point deduction while D only receives 48. That is OK. The points are meant to represent weight in the community at large - a recurrent closed loop of mutual backpatting may have value for the individuals, but means little for the group.
- The fact points are potentially lost in a transfer also discourages users of thinking of these as money, or trying to add financial primitives on top. The contract will always control assignment, so users couldn't transfer them arbitrarily like they can transfer an SPL token. However, I could see a primitive where a bot acting as a pool controls a large volume of kudos, and users attempt to trade with it via side channels. The fact no user can be guaranteed to get an exact allocation will introduce a fuzziness to such a trade that should discourage it.
- Someone *could* set up a reputation faucet, but those only need to be identified once for any reputation heuristic that wishes to discount them (given their outputs remain tagged).
- We can see this offers a measure of Sybil resistance: while someone could set up a group of accounts for a reputation circle-jerk, this would be obvious because 1) reputation origins would tightly cluster, and 2) there would be reputational loss on circular transfers.  It bears further modeling, though.

## Reputation trolling

There is a potential for reputation trolling - eg., a known, hated Nazi gifting you a lot of rep points to be a dick by pretending they like you.

Given these UTXOs will be used to create associations between users, users should be able to reject points sent by a different user.

There are built-in measures to dissuade this:

1. In that scenario, they'd have to spend some of their limited reputation doing that, and it should be fairly obvious to anyone writing a custom reputation heuristic;
2. There are other solutions as well, such as simply allowing users to opt in before receiving kudos from someone;
3. Allowing users to opt in also trivially allows for blocking - if I block Stalin, and he tries to send me kudos to pretend we think alike, he loses that reputation share that I never claimed.

The implementation considerations are:

- Rejecting a point assignment happens for the entire transfer - you don't get to cherry-pick. Otherwise you could say *"I'm happy receiving A&B points from A, but exclude any C points that A tried to send"*.  If you want to be associated with A, you get all their baggage.
- This means you don't get to alter the point composition - you only get to decide on if you want to be associated with A at all.
- These points should also decay while they are unclaimed - otherwise it lends itself for users to claim a bunch of points at once for a sudden rep boost.

This is the approach that Morat currently takes - if you block Stalin, any points they try to assign to you will end up in an unclaimed limbo, and will not impact your reputation.

You *can* still get some Stalin reputation by association, however - if you associate with someone who is willing to receive kudos from Stalin, and they send you kudos, you may get some Stalin-tagged points yourself. This is intentional. The only way to avoid this is to be mindful of who you opt in to receive reputation from.


## Other considerations

- There is currently a system user called `morat`, added as an experiment to see what happens if someone were to get a percentage of all system reputation assignments. We also expect this can act as a reputation sink, to further discourage circular assignments. The rules are:
    - It will get 1% of every point assignment;
    - It will never transfer out;
    - We apply a floor to the points, meaning it will not get any reputation boost on assignments of less than 100 points;
    - Its reputation will decay the same as everyone else's.
