import 'mocha'
import { withTestConfig, SubscriptionSession } from 'rascal'
import { expect } from 'chai'
import { forAwaitEach } from 'iterall'
import { mock, spy, restore, stub } from 'simple-mock'
import { RascalPubSub } from '../rascal-pubsub'
import { isAsyncIterable } from 'iterall'

const wait = (timeout: number) => new Promise((resolve) => setTimeout(resolve, timeout))

const brokerConfig = withTestConfig({
    vhosts: {
        '/': {
            queues: ['Posts', 'Authors'],
            publications: {
                Posts: {
                    queue: 'Posts',
                },
                Authors: {
                    queue: 'Authors',
                },
            },
            subscriptions: {
                Posts: {
                    queue: 'Posts',
                },
                Authors: {
                    queue: 'Authors',
                },
            },
        },
    },
})

describe('RascalPubSub', () => {
    after('Restore mocks', () => {
        restore()
    })

    it('should verify calling close shuts down the broker', async () => {
        // setup pubsub
        const pubsub = new RascalPubSub({ brokerConfig })
        // setup spies
        const broker = await pubsub.getBroker()
        const shutdownSpy = mock(broker, 'shutdown')
        // cleanup
        await pubsub.close()

        // asserts
        expect(shutdownSpy.called).to.be.true
    })

    it('should create default Rascal client if none were provided', async () => {
        // setup pubsub
        const pubsub = new RascalPubSub({ brokerConfig })
        // cleanup
        await pubsub.close()

        // asserts
        expect(await pubsub.getBroker()).to.be.not.undefined
    })

    it('can subscribe to a Rascal subscription', async () => {
        // setup pubsub
        const pubsub = new RascalPubSub({ brokerConfig })
        // setup spies
        const broker = await pubsub.getBroker()
        const subscribeSpy = mock(broker, 'subscribe')
        // call subscribe
        const id = await pubsub.subscribe('Posts', () => undefined)
        // cleanup
        await pubsub.close()

        // asserts
        expect(id).to.be.a('number')
        expect(subscribeSpy.callCount).to.equal(1)
    })

    it('can unsubscribe from a Rascal subscription', async () => {
        // setup pubsub
        const pubsub = new RascalPubSub({ brokerConfig })
        // setup spies
        const broker = await pubsub.getBroker()
        const subscribeSpy = mock(broker, 'subscribe')
        // subscribe
        const id = await pubsub.subscribe('Posts', () => null)
        // more spies
        const unsubscribeSpy = mock(await subscribeSpy.lastCall.returned, 'cancel')
        // call unsubscribe
        await pubsub.unsubscribe(id)

        // cleanup
        await pubsub.close()

        // asserts
        expect(subscribeSpy.callCount).to.equal(1)
        expect(unsubscribeSpy.callCount).to.equal(1)
    })

    it('can subscribe to a Rascal subscription and called when published to', async () => {
        // setup pubsub
        const pubSub = new RascalPubSub({ brokerConfig })
        // setup spies
        const onMessageSpy = spy(() => undefined)
        const broker = await pubSub.getBroker()
        const subscribeSpy = mock(broker, 'subscribe')
        // call subscribe
        const id = await pubSub.subscribe('Posts', onMessageSpy)
        // publish a message
        await pubSub.publish('Posts', 'test')
        // cleanup
        await pubSub.close()

        // asserts
        expect(id).to.be.a('number')
        expect(subscribeSpy.callCount).to.equal(1)
        expect(onMessageSpy.callCount).to.equal(1)
        expect(onMessageSpy.lastCall.args[0]).to.equal('test')
    })

    it('should not allow double subscribing to a Rascal subscription', async () => {
        // setup pubsub
        const pubsub = new RascalPubSub({ brokerConfig })
        // spies
        const onMessageSpy = spy(() => null)
        const broker = await pubsub.getBroker()
        const subscribeSpy = mock(broker, 'subscribe')

        try {
            // subscribe to a subscription twice
            // should error
            expect(await Promise.all([pubsub.subscribe('Posts', onMessageSpy), pubsub.subscribe('Posts', onMessageSpy)])).to.throw(
                'Already subscribed to this subscription'
            )
        } catch {}

        // clean up
        await pubsub.close()

        // assert
        expect(subscribeSpy.callCount).to.be.equal(2)
    })

    it('should handle primitive messages', async () => {
        // setup pubsub
        const pubsub = new RascalPubSub({ brokerConfig })
        // spies
        const onMessageSpy = spy(() => null)
        // payloads
        const string = 'string'
        const bool = true
        const number = 100

        await pubsub.subscribe('Posts', onMessageSpy)

        await pubsub.publish('Posts', string)
        await pubsub.publish('Posts', bool)
        await pubsub.publish('Posts', number)

        // wait for our messages to publish
        await wait(50)

        // cleanup
        await pubsub.close()

        // asserts
        expect(onMessageSpy.callCount).to.equal(3)
        expect(onMessageSpy.calls[0].args[0]).to.equal(string)
        expect(onMessageSpy.calls[1].args[0]).to.equal(bool)
        expect(onMessageSpy.calls[2].args[0]).to.equal(number)
    })

    it('should handle object messages', async () => {
        // setup pubsub
        const pubsub = new RascalPubSub({ brokerConfig })
        // spies
        const onMessageSpy = spy(() => null)
        const payload = { message: 'testing' }
        // subscribe
        await pubsub.subscribe('Posts', onMessageSpy)
        // publish a message
        await pubsub.publish('Posts', payload)
        // cleanup
        await pubsub.close()

        // asserts
        expect(onMessageSpy.callCount).to.equal(1)
        expect(onMessageSpy.lastCall.args[0]).to.eqls(payload)
    })

    it('should support subscribing and unsubscribing using Promise.All', async () => {
        // setup pubsub
        const pubsub = new RascalPubSub({ brokerConfig })
        // spies
        const broker = await pubsub.getBroker()
        const subscribeSpy = mock(broker, 'subscribe')
        const onMessageSpy = spy(() => null)
        // subscribe using Promise.all
        const subIds = await Promise.all([pubsub.subscribe('Posts', onMessageSpy), pubsub.subscribe('Authors', onMessageSpy)])
        // unsubscribe using Promise.all
        await Promise.all(subIds.map(pubsub.unsubscribe.bind(pubsub)))
        // cleanup
        await pubsub.close()

        // asserts
        expect(subIds.length).to.be.equal(2)
        expect(subscribeSpy.callCount).to.be.equal(2)

        // checking an internal method
        expect((<any>pubsub).subscriptionMap.size).to.equal(0)
    })

    it('refuses custom reviver with a deserializer', async () => {
        const reviver = stub()
        const deserializer = stub()

        try {
            expect(new RascalPubSub({ brokerConfig, reviver, deserializer })).to.throw("Reviver and deserializer can't be used together")
        } catch {}
    })

    it('allows use of a custom deserializer', async () => {
        // spies
        const onMessageSpy = spy(() => null)
        const payload = { message: 'this is great' }
        const deserializer = stub().returnWith(payload)

        // setup pubsub
        const pubsub = new RascalPubSub({ brokerConfig, deserializer })
        // subscribe
        // publish a message
        await pubsub.subscribe('Posts', onMessageSpy)
        await pubsub.publish('Posts', null)
        // cleanup
        await pubsub.close()

        // asserts
        expect(deserializer.callCount).to.equal(1)
        expect(onMessageSpy.callCount).to.equal(1)
        expect(onMessageSpy.lastCall.args[0]).to.eqls(payload)
    })

    it('throws error if you try to unsubscribe with an unknown id', async () => {
        const pubsub = new RascalPubSub({ brokerConfig })
        try {
            expect(await pubsub.unsubscribe(90)).to.throw("There is not a subscription with the id '90'")
        } catch {}
    })

    it('allows use of a custom reviver', async () => {
        const reviver = spy((key, value) => {
            const isISO8601Z = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d*)?)Z$/
            if (typeof value === 'string' && isISO8601Z.test(value)) {
                const tempDateNumber = Date.parse(value)
                if (!isNaN(tempDateNumber)) {
                    return new Date(tempDateNumber)
                }
            }
            return value
        })
        const payload = new Date()
        const onMessageSpy = spy(() => null)

        // setup pubsub
        const pubsub = new RascalPubSub({ brokerConfig, reviver })
        // subscribe
        await pubsub.subscribe('Posts', onMessageSpy)
        await pubsub.publish('Posts', payload)
        // cleanup
        await pubsub.close()

        // asserts
        expect(onMessageSpy.lastCall.args[0]).to.eqls(payload)
        expect(reviver.callCount).to.equal(1)
    })
})

describe('PubSubAsyncIterator', () => {
    it('should expose valid asyncItrator for a specific event', () => {
        const pubsub = new RascalPubSub({ brokerConfig })
        const eventName = 'Posts'
        const iterator = pubsub.asyncIterator(eventName)

        expect(iterator).to.exist
        expect(isAsyncIterable(iterator)).to.be.true
    })

    it('should trigger event on asyncIterator when published', (done) => {
        const pubsub = new RascalPubSub({ brokerConfig })
        const eventName = 'Posts'
        const iterator = pubsub.asyncIterator(eventName)

        iterator.next().then((result) => {
            pubsub.close()

            expect(result).to.exist
            expect(result.value).to.exist
            expect(result.done).to.exist
            done()
        })

        setTimeout(() => {
            pubsub.publish(eventName, { test: true })
        }, 50)
    })

    it('should not trigger event on asyncIterator when publishing other events', (done) => {
        const pubsub = new RascalPubSub({ brokerConfig })
        const iterator = pubsub.asyncIterator('Posts')
        const triggerSpy = spy(() => undefined)

        iterator.next().then(triggerSpy)

        setTimeout(async () => {
            await pubsub.publish('Authors', 'testing')
            await pubsub.close()
            expect(triggerSpy.callCount).to.equal(0)
            done()
        }, 50)
    })

    it('should allow registering to multiple events', (done) => {
        const pubSub = new RascalPubSub({ brokerConfig })
        const iterator = pubSub.asyncIterator(['Authors', 'Posts'])

        iterator.next().then((result) => {
            expect(result).to.exist
            expect(result).to.exist
            expect(result.value).to.exist
            expect(result.done).to.exist

            pubSub.close().then(() => done())
        })

        setTimeout(() => {
            pubSub.publish('Authors', { test: true })
        }, 250)
    })

    it('should not trigger event on asyncIterator already returned', (done) => {
        const pubSub = new RascalPubSub({ brokerConfig })
        const eventName = 'Posts'
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
        }, 50)
    })
})
