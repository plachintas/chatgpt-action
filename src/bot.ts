import './fetch-polyfill.js'
import {Options} from './options.js'
import * as core from '@actions/core'
import OpenAI from 'openai'

export class Bot {
  private openai: OpenAI | null = null
  private history: OpenAI.Chat.ChatCompletionMessage[] = []

  private options: Options

  constructor(options: Options) {
    this.options = options
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        timeout: 30 * 1000 // Set to 30 seconds, the default is 10 min.
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
      core.warning(
        `Failed to chat: ${err}, backtrace: ${err.stack}, status: ${err.status}`
      )
    } finally {
      console.timeEnd(`chatgpt ${action} ${message.length} tokens cost`)
    }

    return response
  }

  private chat_ = async (action: string, message: string, initial = false) => {
    if (!message) {
      return ''
    }
    if (message.length > this.options.max_prompt_chars_count) {
      core.warning(
        `Message is too long, truncate to ${this.options.max_prompt_chars_count} chars`
      )
      message = message.substring(0, this.options.max_prompt_chars_count)
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
        model: this.options.model,
        temperature: 0
      }
      core.info(`chatCompletion messages count: ${messages.length}`)

      try {
        chatCompletion = await this.openai.chat.completions.create(params)
      } catch (error: any) {
        // In case this is a RateLimitError, we retry after the suggested time
        // More info regarding OpenAI API errors: https://github.com/openai/openai-node#handling-errors
        if (error instanceof OpenAI.APIError && error.status === 429) {
          const retryAfter =
            (Number(error.headers?.['retry-after']) || 20) * 1000
          core.info(`Rate limit exceeded, retry after ${retryAfter} seconds`)
          await new Promise(resolve => setTimeout(resolve, retryAfter))
          chatCompletion = await this.openai.chat.completions.create(params)
        } else {
          throw error
        }
      }

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
