import { BrokerConfig, SubscriptionSession, BrokerAsPromised as Broker, AckOrNack, BrokerAsPromised } from 'rascal'
import { PubSubEngine } from 'graphql-subscriptions'
import { PubSubAsyncIterator } from './pubsub-async-iterator'

type SubscriptionMap = Map<number, SubscriptionSession>

export type ConnectionListener = (err: Error) => void
export type Handler<T> = (payload: T, ackOrNack: AckOrNack) => void
export type Deserializer = (source: string) => any
export type Reviver = (key: any, value: any) => any

/**
 * Options for creating a RascalPubSub
 */
export interface PubSubRascalOptions {
    /**
     * @type {BrokerConfig}
     * Rascal broker configuration
     */
    brokerConfig?: BrokerConfig

    /**
     * @type {ConnectionListener}
     * Listener to publish errors too
     */
    connectionListener?: ConnectionListener

    /**
     * @type {Deserializer}
     * Function used to deserialize messages
     */
    deserializer?: Deserializer

    /**
     * @type {Reviver}
     * Reviver used for reviving messages using JSON.parse
     */
    reviver?: Reviver
}

/**
 * @class
 * A class implementing the PubSubEngine for use with Rabbitmq and Rascal
 */
export class RascalPubSub implements PubSubEngine {
    /**
     * @constructor
     *
     * @param options @type {PubSubRascalOptions}
     * Options used for configuring the PubSubEngine
     */
    constructor({ brokerConfig, connectionListener, deserializer, reviver }: PubSubRascalOptions = {}) {
        if (reviver && deserializer) {
            throw new Error("Reviver and deserializer can't be used together")
        }

        this.brokerConfig = brokerConfig
        this.connectionListener = connectionListener
        this.deserializer = deserializer
        this.reviver = reviver
    }

    /**
     * Getter used to lazily start/configure the Rascal broker.
     *
     * @returns @type {Promise<Broker>}
     * A promise of a Broker
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
     *
     * @param publication @type {string}
     * Rascal publication name
     *
     * @param payload @type {T}
     * Message payload
     */
    async publish<T>(publication: string, payload: T): Promise<void> {
        await (await this.getBroker()).publish(publication, payload)
    }

    /**
     * Subscribes to a Rascal subscription
     *
     * @param subscription @type {string}
     * Rascal subscription name
     *
     * @param handler @type {Handler<T>}
     * Listener that will handle the messages for the subscription
     *
     * @param options @type {Object}
     * Rascal subscription options
     *
     * @returns @type {Promise<number>}
     * Subscription ID
     */
    async subscribe<T>(subscription: string, handler: Handler<T>, options?: Object): Promise<number> {
        // get our subscription id
        // subscribe to the Rascal broker
        const id = this.currentSubscriptionId++
        const sub = await (await this.getBroker()).subscribe(subscription, options)

        // wire up our message listener
        // wire up our connection listener
        sub.on('message', (message, content, ackOrNack) => {
            let parsedMessage: T

            // try parse our message using the provided
            // deserializer/reviver
            // default to the 'content' if parsing fails
            try {
                parsedMessage = this.deserializer
                    ? this.deserializer(message.content.toString())
                    : JSON.parse(message.content.toString(), this.reviver)
            } catch {
                parsedMessage = content
            }

            // call the handler
            handler(parsedMessage, ackOrNack)
        })

        // wire up our connection listener
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
     *
     * @param subId @type {number}
     * Subscription ID
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

    asyncIterator<T>(triggers: string | string[], options?: Object): AsyncIterator<T> {
        return new PubSubAsyncIterator<T>(this, triggers, options)
    }

    /**
     * @type {Deserializer}
     * Function used to deserialize messages
     */
    private deserializer?: Deserializer

    /**
     * @type {Reviver}
     * Reviver used for reviving messages using JSON.parse
     */
    private reviver?: Reviver

    /**
     * @type {ConnectionListener}
     * Listener to publish errors too
     */
    private connectionListener?: ConnectionListener

    /**
     * @type {BrokerConfig}
     * Rascal broker configuration
     */
    private brokerConfig?: BrokerConfig

    /**
     * @type {number}
     * Keeps track of the current subscription ID.
     */
    private currentSubscriptionId: number = 0

    /**
     * @type {BrokerAsPromised}
     * Backer field that holds the Rascal broker.
     */
    private _broker: Broker

    /**
     * @type {SubscriptionMap}
     * Mapping of triggers to their Rascal subscription and subscriber IDs
     */
    private subscriptionMap: SubscriptionMap = new Map<number, SubscriptionSession>()
}
