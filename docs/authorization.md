# Authorization

How to protect a route. Every piece below lives in `backend/src/auth`. Import `AuthModule` in your feature module to use the guards.

## Who is signed in

```ts
@UseGuards(JwtAuthGuard)
@Get('mine')
list(@CurrentUser() user: UserDocument) { ... }
```

`JwtAuthGuard` returns 401 when nobody is logged in or the session expired. It returns 403 for suspended or deactivated accounts, and for accounts that must first change a temporary password.

## Role-only routes

```ts
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Post()
createAirline(...) { ... }   // FLT-01: only admins create airlines
```

Anyone without one of the listed roles gets 403.

## Moderators manage only their own airline or hotel

**The URL contains the provider id** (`/api/airlines/:id`, `/api/hotels/:id/rooms`):

```ts
@UseGuards(JwtAuthGuard, ProviderOwnerGuard)
@ManagesProvider(ProviderType.AIRLINE)          // reads :id
@Put(':id/baggage-policy')
setBaggagePolicy(...) { ... }

@ManagesProvider(ProviderType.HOTEL, 'hotelId') // another parameter name
```

Admins, travelers and the other kind of moderator get 403, and so does a moderator of a different provider. A malformed id gets 404.

**The URL contains a child record** (`/api/flights/:id`): load the record, then check the provider it belongs to.

```ts
const flight = await this.flightModel.findById(id);
if (!flight) throw new NotFoundException('Flight not found.');
assertManagesProvider(user, ProviderType.AIRLINE, flight.airlineId);
```

To filter instead of fail, `managesProvider(user, type, id)` returns `true` or `false`.

## Owners only (ACC-11)

Bookings and private itineraries are visible only to their owner:

```ts
const booking = await this.bookingModel.findById(id);
if (!booking) throw new NotFoundException('Booking not found.');
assertOwnedBy(user, booking.userId, 'Booking not found.');
```

Anyone else gets the same 404 as for a missing record, so they cannot tell whether it exists. For lists, filter in the query, for example `{ userId: user._id }`. Admins viewing all bookings (ACC-17) and moderators viewing their provider's bookings (FLT-29, HTL-22) get their own routes. Don't add exceptions to `assertOwnedBy`.
