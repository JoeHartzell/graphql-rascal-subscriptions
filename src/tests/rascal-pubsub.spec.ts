import 'mocha'
import { expect } from 'chai'
import { mock, spy, restore } from 'simple-mock'
import { RascalPubSub } from '../rascal-pubsub'

// Mocking Rascal broker
let listener

const cancelSubscriptionSpy = spy((name) => {})
const ackOrNackSpy = spy(() => {})
const subscribeSpy = spy((subscription, options) =>
    Promise.resolve({
        on: (event, cb) => {
            if (event === 'message') {
                listener = cb
            }
        },
        cancel: () => cancelSubscriptionSpy(subscription),
    })
)

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

        const subIds = [await pubsub.subscribe('Posts', onMessageSpy), await pubsub.subscribe('Posts', onMessageSpy)]

        expect(subIds.length).to.be.equal(2)

        await pubsub.publish('Posts', 'test')

        expect(onMessageSpy.callCount).to.equal(2)
        onMessageSpy.calls.forEach((call) => {
            expect(call.args).to.have.members(['test', ackOrNackSpy])
        })
    })
})
