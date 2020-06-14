import 'mocha'
import { expect } from 'chai'
import { mock, spy, restore } from 'simple-mock'
import { RascalPubSub } from '../rascal-pubsub'
import { isAsyncIterable } from 'iterall'

/* TODO:
 * In the tests below there are some setTimeout(() => {}, 0) methods. These are too ensure that the publishing
 * of the event occurs after the asyncIterator.next has been called. This is because if publish is called before .next is executed,
 * the iterator will miss the publish.
 *
 * Need to determine if this is intended functionality, or if setTimeout is acting as a hack
 */

// Mocking Rascal broker
let listener

const cancelSubscriptionSpy = spy((name) => {})
const ackOrNackSpy = spy(() => {})
const subscribeSpy = spy((subscription, options) => ({
    on: (event, cb) => {
        if (event === 'message') {
            listener = cb
        }
    },
    cancel: () => cancelSubscriptionSpy(subscription),
}))

const publishSpy = spy((name, payload) => listener && listener(null, payload, ackOrNackSpy))
const mockRascalBroker = {
    subscribe: subscribeSpy,
    publish: publishSpy,
}

describe('RascalPubSub', () => {
    afterEach('Reset spy count', () => {
        cancelSubscriptionSpy.reset()
        ackOrNackSpy.reset()
        subscribeSpy.reset()
        publishSpy.reset()
    })

    after('Restore mocks', () => {
        restore()
    })

    it('should verify calling close shuts down the broker', async () => {
        const pubsub = new RascalPubSub()
        const broker = await pubsub.getBroker()
        const shutdownSpy = mock(broker, 'shutdown')
        await pubsub.close()

        expect(shutdownSpy.called).to.be.true
    })

    it('should create default Rascal client if none were provided', async () => {
        const pubsub = new RascalPubSub()

        expect(await pubsub.getBroker()).to.be.not.undefined

        await pubsub.close()
    })

    it('can subscribe to a Rascal subscription and called when published to', async () => {
        const pubSub = new RascalPubSub()
        mock(pubSub, 'getBroker').resolveWith(mockRascalBroker)

        const id = await pubSub.subscribe('Posts', (payload, ackOrNack) => {
            expect(payload).to.equal('test')
        })

        await pubSub.publish('Posts', 'test')

        expect(id).to.be.a('number')
    })

    it('can unsubscribe from a Rascal subscription', async () => {
        const pubsub = new RascalPubSub()
        mock(pubsub, 'getBroker').resolveWith(mockRascalBroker)

        const id = await pubsub.subscribe('Posts', () => null)

        await pubsub.unsubscribe(id)

        expect(cancelSubscriptionSpy.callCount).to.equal(1)
        expect(cancelSubscriptionSpy.lastCall.args).to.have.members(['Posts'])
    })

    it('will not unsubscribe from a subscription if there is more than one subscriber', async () => {
        const pubsub = new RascalPubSub()
        mock(pubsub, 'getBroker').resolveWith(mockRascalBroker)

        const subIds = [
            await pubsub.subscribe('Posts', () => null),
            await pubsub.subscribe('Posts', (payload) => {
                expect(payload).to.equal('test')
            }),
        ]

        expect(subIds.length).to.equal(2)

        await pubsub.unsubscribe(subIds[1])
        expect(cancelSubscriptionSpy.callCount).to.be.equal(0)

        await pubsub.publish('Posts', 'test')

        await pubsub.unsubscribe(subIds[0])
        expect(cancelSubscriptionSpy.callCount).to.be.equal(1)
    })

    it('will subscribe to Rascal subscription only once', async () => {
        const pubsub = new RascalPubSub()
        mock(pubsub, 'getBroker').resolveWith(mockRascalBroker)

        const subIds = [await pubsub.subscribe('Posts', () => null), await pubsub.subscribe('Posts', () => null)]

        expect(subIds.length).to.equal(2)
        expect(subscribeSpy.callCount).to.equal(1)
    })

    it('can have multiple subscribers and all will be called when published', async () => {
        const onMessageSpy = spy(() => null)
        const pubsub = new RascalPubSub()
        mock(pubsub, 'getBroker').resolveWith(mockRascalBroker)

        const subIds = await Promise.all([pubsub.subscribe('Posts', onMessageSpy), pubsub.subscribe('Posts', onMessageSpy)])

        await pubsub.publish('Posts', 'test')

        expect(subIds.length).to.be.equal(2)
        expect(onMessageSpy.callCount).to.equal(2)
        onMessageSpy.calls.forEach((call) => {
            expect(call.args).to.have.members(['test', ackOrNackSpy])
        })
    })

    it('should handle primitive messages', async () => {
        const pubsub = new RascalPubSub()
        mock(pubsub, 'getBroker').resolveWith(mockRascalBroker)

        const string = 'string'
        const date = new Date()
        const bool = true
        const number = 100
        const symbol = Symbol('symbol')

        const subIds = []

        subIds.push(
            await pubsub.subscribe('string', (message) => {
                expect(message).to.equal(string)
            })
        )

        await pubsub.publish('string', string)

        subIds.push(
            await pubsub.subscribe('date', (message) => {
                expect(message).to.equal(date)
            })
        )

        await pubsub.publish('date', date)

        subIds.push(
            await pubsub.subscribe('bool', (message) => {
                expect(message).to.equal(bool)
            })
        )

        await pubsub.publish('bool', bool)

        subIds.push(
            await pubsub.subscribe('number', (message) => {
                expect(message).to.equal(number)
            })
        )

        await pubsub.publish('number', number)

        subIds.push(
            await pubsub.subscribe('undefined', (message) => {
                expect(message).to.equal(undefined)
            })
        )

        await pubsub.publish('undefined', undefined)

        subIds.push(
            await pubsub.subscribe('symbol', (message) => {
                expect(message).to.equal(symbol)
            })
        )

        await pubsub.publish('symbol', symbol)

        await Promise.all(subIds.map(pubsub.unsubscribe.bind(pubsub)))

        expect(cancelSubscriptionSpy.callCount).to.be.equal(6)
        expect(subscribeSpy.callCount).to.be.equal(6)
        expect(publishSpy.callCount).to.be.equal(6)
    })

    it('should handle object messages', async () => {
        const payload = {
            message: 'testing',
            date: new Date(),
        }
        const pubsub = new RascalPubSub()
        mock(pubsub, 'getBroker').resolveWith(mockRascalBroker)

        const subId = await pubsub.subscribe('Posts', (message) => {
            expect(message).to.equal(payload)
        })

        await pubsub.publish('Posts', payload)
        await pubsub.unsubscribe(subId)

        expect(cancelSubscriptionSpy.callCount).to.be.equal(1)
        expect(publishSpy.callCount).to.be.equal(1)
        expect(subscribeSpy.callCount).to.be.equal(1)
    })

    it('should support subscribing and unsubscribing using Promise.All', async () => {
        const pubsub = new RascalPubSub()
        const onMessageSpy = spy(() => null)
        mock(pubsub, 'getBroker').resolveWith(mockRascalBroker)

        const subIds = await Promise.all([
            pubsub.subscribe('Posts', onMessageSpy),
            pubsub.subscribe('Posts', onMessageSpy),
            pubsub.subscribe('Author', onMessageSpy),
        ])

        await Promise.all(subIds.map(pubsub.unsubscribe.bind(pubsub)))

        expect(subIds.length).to.be.equal(3)
        expect(subscribeSpy.callCount).to.be.equal(3)
        expect(cancelSubscriptionSpy.callCount).to.be.equal(2)
    })
})

describe('PubSubAsyncIterator', () => {
    it('should expose valid asyncItrator for a specific event', () => {
        const pubsub = new RascalPubSub()
        mock(pubsub, 'getBroker').resolveWith(mockRascalBroker)
        const eventName = 'posts'
        const iterator = pubsub.asyncIterator(eventName)

        expect(iterator).to.exist
        expect(isAsyncIterable(iterator)).to.be.true
    })

    it('should trigger event on asyncIterator when published', (done) => {
        const pubsub = new RascalPubSub()
        mock(pubsub, 'getBroker').resolveWith(mockRascalBroker)
        const eventName = 'posts'
        const iterator = pubsub.asyncIterator([eventName])

        iterator.next().then((result) => {
            expect(result).to.exist
            expect(result.value).to.exist
            expect(result.done).to.exist
            done()
        })

        setTimeout(() => {
            pubsub.publish(eventName, { test: true })
        }, 0)
    })

    it('should not trigger event on asyncIterator when publishing other events', (done) => {
        const pubsub = new RascalPubSub()
        mock(pubsub, 'getBroker').resolveWith(mockRascalBroker)
        const iterator = pubsub.asyncIterator('posts')
        const triggerSpy = spy(() => undefined)

        iterator.next().then(triggerSpy)

        setTimeout(async () => {
            await pubsub.publish('author', 'testing')
            expect(triggerSpy.callCount).to.equal(0)
            done()
        }, 0)
    })

    it('should allow registering to multiple events', (done) => {
        const pubSub = new RascalPubSub()
        mock(pubSub, 'getBroker').resolveWith(mockRascalBroker)
        const eventName = 'test2'
        const iterator = pubSub.asyncIterator(['test', 'test2'])
        const triggerSpy = spy(() => undefined)

        iterator.next().then(() => {
            triggerSpy()
            expect(triggerSpy.callCount).to.be.gte(1)
            done()
        })

        setTimeout(() => {
            pubSub.publish(eventName, { test: true })
        }, 0)
    })

    it('should not trigger event on asyncIterator already returned', (done) => {
        const pubSub = new RascalPubSub()
        mock(pubSub, 'getBroker').resolveWith(mockRascalBroker)
        const eventName = 'test'
        const iterator = pubSub.asyncIterator<any>(eventName)

        iterator.next().then((result) => {
            // tslint:disable-next-line:no-unused-expression
            expect(result).to.exist
            // tslint:disable-next-line:no-unused-expression
            expect(result.value).to.exist
            expect(result.value.test).to.equal('word')
            // tslint:disable-next-line:no-unused-expression
            expect(result.done).to.be.false
        })

        setTimeout(() => {
            pubSub.publish(eventName, { test: 'word' }).then(() => {
                iterator.next().then((result) => {
                    // tslint:disable-next-line:no-unused-expression
                    expect(result).to.exist
                    // tslint:disable-next-line:no-unused-expression
                    expect(result.value).not.to.exist
                    // tslint:disable-next-line:no-unused-expression
                    expect(result.done).to.be.true
                    done()
                })

                iterator.return()
                pubSub.publish(eventName, { test: true })
            })
        }, 0)
    })
})
