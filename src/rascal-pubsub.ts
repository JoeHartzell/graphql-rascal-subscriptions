import { BrokerConfig, SubscriptionSession, BrokerAsPromised as Broker, AckOrNack } from 'rascal'
import { PubSubEngine } from 'graphql-subscriptions'
import { Message } from 'amqplib'

type SubscriptionMap = Map<string, { subscription: SubscriptionSession; refs: { [id: number]: Handler<any> } }>

export type ConnectionListener = (err: Error) => void
export type Handler<T> = (payload: T, ackOrNack: AckOrNack) => void
export interface PubSubRascalOptions {
    brokerConfig?: BrokerConfig
    connectionListener?: ConnectionListener
}

export class RascalPubSub implements PubSubEngine {
    constructor(options: PubSubRascalOptions = {}) {
        const { brokerConfig, connectionListener } = options

        this.brokerConfig = brokerConfig
        this.connectionListener = connectionListener
    }

    /**
     * Getter used to lazily start/configure the Rascal broker.
     */
    get broker(): Promise<Broker> {
        if (this._broker !== undefined) return Promise.resolve(this._broker)

        return (async (): Promise<Broker> => {
            this._broker = await Broker.create(this.brokerConfig)
            this._broker.on('error', this.connectionListener ?? console.error)
            return this._broker
        })()
    }

    async publish<T>(triggerName: string, payload: T): Promise<void> {
        await (await this.broker).publish(triggerName, payload)
    }

    async subscribe<T>(triggerName: string, handler: Handler<T>, options: Object): Promise<number> {
        const broker = await this.broker
        const id = this.currentSubscriptionId++

        // check for a missing subscription map for the given trigger
        const subscriptionRef = this.subscriptionMap.get(triggerName)
        if (subscriptionRef === undefined) {
            // create our rascal subscription
            const subscription = await broker.subscribe(triggerName)
            subscription.on('message', (message, content, ackOrNack) => this.onMessage(message, content, ackOrNack, triggerName))
            subscription.on('error', this.connectionListener ?? console.error)

            // create our refs for the subscription mapping
            const refs = {
                [id]: handler,
            }

            // add a subscription mapping for this trigger
            this.subscriptionMap.set(triggerName, {
                subscription,
                refs,
            })
        }
        // subscription ref exists
        else {
            subscriptionRef.refs[id] = handler
        }

        return id
    }

    async unsubscribe(subId: number) {
        for (let [triggerName, { subscription, refs }] of this.subscriptionMap) {
            // nothing to remove
            if (refs[subId] === undefined) continue

            if (Object.keys(refs).length === 1) {
                // only one ref means we can remove the subscription all together
                await subscription.cancel()
                // remove the subscription from the map
                this.subscriptionMap.delete(triggerName)
            } else {
                // only need to remove the one ref
                delete refs[subId]
            }
        }
    }

    asyncIterator<T>(triggers: string | string[]): AsyncIterator<T, any, undefined> {
        throw new Error('Method not implemented.')
    }

    private onMessage(message: Message, content: any, ackOrNack: AckOrNack, triggerName: string) {
        const { refs } = this.subscriptionMap.get(triggerName)

        for (const handler of Object.values(refs)) {
            handler(content, ackOrNack)
        }
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
    private subscriptionMap: SubscriptionMap = new Map<string, { subscription: SubscriptionSession; refs: { [id: number]: Handler<any> } }>()
}
