import './fetch-polyfill.js'
import {Options} from './options.js'
import * as core from '@actions/core'
import OpenAI from 'openai'

export class Bot {
  private openai: OpenAI | null = null
  private history: OpenAI.Chat.ChatCompletionMessage[] = []
  private MAX_PATCH_COUNT: number = 30000 // Previously was 4000

  private options: Options

  constructor(options: Options) {
    this.options = options
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        // maxRetries: 0,
        timeout: 20 * 1000 // the default is 10 min
      })
    } else {
      const err =
        'Unable to initialize the chatgpt API, ' +
        "'OPENAI_API_KEY' environment variable is not available"
      throw new Error(err)
    }
  }

  public chat = async (action: string, message: string, initial = false) => {
    console.time(`chatgpt ${action} ${message.length} tokens cost`)
    let response = null
    try {
      response = await this.chat_(action, message, initial)
    } catch (err: any) {
      // In case this is a RateLimitError, we retry after the suggested time
      if (err && err.status === 429) {
        const retryAfter = (Number(err.headers?.['retry-after']) || 20) * 1000
        core.warning(`Rate limit exceeded, retry after ${retryAfter} seconds`)
        await new Promise(resolve => setTimeout(resolve, retryAfter))
        try {
          response = await this.chat_(action, message, initial)
        } catch (err: any) {
          core.warning(`Failed to chat: ${err}, backtrace: ${err.stack}`)
        }
      } else if (err) {
        core.warning(`Failed to chat: ${err}, backtrace: ${err.stack}`)
      }
    } finally {
      console.timeEnd(`chatgpt ${action} ${message.length} tokens cost`)
    }

    return response
  }

  private chat_ = async (action: string, message: string, initial = false) => {
    if (!message) {
      return ''
    }
    if (message.length > this.MAX_PATCH_COUNT) {
      core.warning(
        `Message is too long, truncate to ${this.MAX_PATCH_COUNT} tokens`
      )
      message = message.substring(0, this.MAX_PATCH_COUNT)
    }
    if (this.options.debug) {
      core.info(`sending to chatgpt: ${message}`)
    }

    let chatCompletion: OpenAI.Chat.ChatCompletion | null = null
    let messages: OpenAI.ChatCompletionMessageParam[] = []
    if (this.openai) {
      if (this.history.length > 0 && !initial) {
        messages = [...this.history]
      }
      messages.push({role: 'user', content: message})
      const params: OpenAI.Chat.ChatCompletionCreateParams = {
        messages,
        model: 'gpt-3.5-turbo',
        temperature: 0
      }

      chatCompletion = await this.openai.chat.completions.create(params)

      try {
        core.info(`chatCompletion: ${JSON.stringify(chatCompletion)}`)
      } catch (e: any) {
        core.info(
          `chatCompletion: ${chatCompletion}, failed to stringify: ${e}, backtrace: ${e.stack}`
        )
      }
    } else {
      core.setFailed('The chatgpt API is not initialized')
    }
    let response_text: string | null = ''
    if (chatCompletion) {
      if (initial) {
        this.history = [...messages, chatCompletion.choices[0].message]
      }
      response_text = chatCompletion.choices[0].message.content
    } else {
      core.warning('chatgpt response is null')
    }
    if (this.options.debug) {
      core.info(`chatgpt responses: ${response_text}`)
    }
    return response_text
  }
}
