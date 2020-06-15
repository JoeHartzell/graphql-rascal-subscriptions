import { BrokerConfig, SubscriptionSession, BrokerAsPromised as Broker, AckOrNack } from 'rascal'
import { PubSubEngine } from 'graphql-subscriptions'
import { PubSubAsyncIterator } from './pubsub-async-iterator'

type SubscriptionMap = Map<number, SubscriptionSession>

export type ConnectionListener = (err: Error) => void
export type Handler<T> = (payload: T, ackOrNack: AckOrNack) => void
export interface PubSubRascalOptions {
    brokerConfig?: BrokerConfig
    connectionListener?: ConnectionListener
}

export class RascalPubSub implements PubSubEngine {
    /**
     *
     * @param options
     */
    constructor({ brokerConfig, connectionListener }: PubSubRascalOptions = {}) {
        this.brokerConfig = brokerConfig
        this.connectionListener = connectionListener
    }

    /**
     * Getter used to lazily start/configure the Rascal broker.
     */
    async getBroker(): Promise<Broker> {
        // check if the broker was already initialized
        if (this._broker !== undefined) {
            // resolve with the initialized broker
            return Promise.resolve(this._broker)
        }

        // create the broker
        this._broker = await Broker.create(this.brokerConfig)
        // setup the connection listener
        return this._broker.on('error', this.connectionListener ?? console.error)
    }

    /**
     * Publishes a message to a Rascal publication
     * @param publication Rascal publication name
     * @param payload Message payload
     */
    async publish<T>(publication: string, payload: T): Promise<void> {
        await (await this.getBroker()).publish(publication, payload)
    }

    /**
     * Subscribes to a Rascal subscription
     * @param subscription Rascal subscription name
     * @param handler Listener that will handle the messages for the subscription
     * @param options Rascal subscription options
     */
    async subscribe<T>(subscription: string, handler: Handler<T>, options?: Object): Promise<number> {
        // get our subscription id
        // subscribe to the Rascal broker
        const id = this.currentSubscriptionId++
        const sub = await (await this.getBroker()).subscribe(subscription, options)

        // wire up our message listener
        // wire up our connection listener
        sub.on('message', (_, content, ackOrNack) => handler(content, ackOrNack))
        sub.on('error', this.connectionListener ?? console.error)

        // check if we are already subscribed
        // checking here is fine since double subscribing above does nothing
        // we also want to check as close as possible to adding this subscription to the map
        const isSubscribed = [...this.subscriptionMap.values()].some((x) => x.name === subscription)
        if (isSubscribed) throw new Error('Already subscribed to this subscription')

        // add an entry to the subscription map
        // this is for unsubscribing later
        this.subscriptionMap.set(id, sub)

        // provide our subId to the caller
        return id
    }

    /**
     * Unsubscribe from a Rascal subscription using the subscription ID
     * @param subId Subscription ID
     */
    async unsubscribe(subId: number) {
        const subscription = this.subscriptionMap.get(subId)

        // make sure the subscription exists
        if (subscription === undefined) throw new Error(`There is not a subscription with the id '${subId}'`)

        // cancel the Rascal subscription
        await subscription.cancel()

        // clean up memory
        this.subscriptionMap.delete(subId)
    }

    /**
     * Shuts down the Rascal broker. Cleans up any open subscriptions
     */
    async close() {
        // shutdown the Rascal broker
        // unsubscribes from all the subscriptions
        await (await this.getBroker()).shutdown()

        // remove all the subscription map records
        this.subscriptionMap.clear()
    }

    asyncIterator<T>(triggers: string | string[], options?: Object): AsyncIterator<T, any, undefined> {
        return new PubSubAsyncIterator<T>(this, triggers, options)
    }

    /**
     * Listener to publish errors too
     */
    private connectionListener?: ConnectionListener

    /**
     * Rascal broker configuration
     */
    private brokerConfig?: BrokerConfig

    /**
     * Keeps track of the current subscription ID.
     */
    private currentSubscriptionId: number = 0

    /**
     * Backer field that holds the Rascal broker.
     */
    private _broker: Broker

    /**
     * Mapping of triggers to their Rascal subscription and subscriber IDs
     */
    private subscriptionMap: SubscriptionMap = new Map<number, SubscriptionSession>()
}
